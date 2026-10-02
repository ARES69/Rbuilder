import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { InspectorPanel, type InspectorTab } from './components/InspectorPanel'
import type { Approval, CommandApproval } from './components/ApprovalPanel'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { BrowserSessionPanel } from './components/BrowserSessionPanel'
import { TaskRail } from './components/TaskRail'
import type { DockTab } from './components/PreviewPane'
import { DEFAULT_PROVIDER_PROFILES, execCommand, fetchAgentConfig, testProvider, type ProviderProfile } from './lib/agent'
import { apiBase, isDesktop } from './lib/apiBase'
import {
  deleteProjectFile,
  deleteViaDirectoryHandle,
  pickProjectFolder,
  pickProjectFolderPath,
  readProjectFolder,
  readViaDirectoryHandle,
  revealInExplorer,
  saveTextFile,
  writeProjectFiles,
  writeViaDirectoryHandle,
  type DirectoryHandle,
  type ImportedFolder,
} from './lib/desktop'
import { GIT_CHANGED_EVENT, readGitState } from './lib/git'
import {
  FOLDER_CHANGED_EVENT,
  notifyFolderSynced,
  planExternalSync,
  watchProjectFolder,
} from './lib/folderWatch'
import { attachmentsToContext, type AttachmentMeta } from './lib/attachments'
import type { Budget } from './lib/budget'
import { runChecks, type ChecksResult } from './lib/checks'
import { applyEdits, type EditBlock, type EditResolution } from './lib/edits'
import { channelFor, PreviewInspector } from './lib/inspector'
import {
  buildPreviewDocument,
  emptyProject,
  hasIndex,
  projectContext,
  projectFilePaths,
  upsertFiles,
  type Project,
  type ProjectFileInput,
} from './lib/project'
import { RUNTIME_SCRIPT } from './lib/previewRuntime'
import { planBundle } from './lib/previewBundle'
import { previewBundler } from './lib/previewCompiler'
import {
  createWorkspace,
  dedupeWorkspaces,
  projectFromWorkspaceFiles,
  readActiveWorkspaceId,
  readStoredWorkspaces,
  type Workspace,
} from './lib/workspace'
import { loadProjectSession, openProjectStore, type ProjectStore } from './lib/projectDb'
import {
  archiveFileName,
  archiveToText,
  createArchive,
  parseArchive,
  readFileAsText,
  workspaceFromArchive,
} from './lib/projectArchive'
import { describeCall, executeTool, makeRunCommandHandler, type ToolOutcome } from './lib/tools'
import { runAgentTurn } from './lib/turn'
import type { AgentMode, ChatTurn } from './lib/protocol'
import { applyTheme, loadTheme, type Theme } from './lib/theme'
import {
  createInitialState,
  loadState,
  reducer,
  saveState,
  uid,
  type ChatMessage,
} from './lib/store'

type View = 'workspace' | 'projects'
type NavId = 'workspace' | 'projects' | 'settings'

/** What the sidebar reports about the terminal workspace, straight from git. */
type GitSummary = { isRepo: boolean; branch: string | null; changes: number; lastCommit: string | null }

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [busy, setBusy] = useState(false)
  /** Live for the duration of one turn: how much time and token budget is left. */
  const [budget, setBudget] = useState<{ budget: Budget; wrappingUp: boolean } | null>(null)
  const [dockTab, setDockTab] = useState<DockTab>('files')
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [runningChecks, setRunningChecks] = useState(false)
  const [, setView] = useState<View>('workspace')
  const [, setActiveNav] = useState<NavId>('workspace')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('inspector')
  /** A changed file asked for by the transcript or the inspector. */
  const [focusFile, setFocusFile] = useState<string | null>(null)
  /** Ask mode: the batch of writes currently waiting for (or declined by) the user. */
  const [approval, setApproval] = useState<Approval | null>(null)
  const approvalResolver = useRef<((ok: boolean) => void) | null>(null)
  /** Ask mode: a command waiting for (or declined by) the user. */
  const [commandApproval, setCommandApproval] = useState<CommandApproval | null>(null)
  const commandApprovalResolver = useRef<((ok: boolean) => void) | null>(null)
  /**
   * The real folder this project's files live in: the model writes land there,
   * and the terminal and git run inside it. Desktop keeps the path; the browser
   * keeps a File System Access handle.
   */
  const folderRef = useRef<string | null>(null)
  const folderHandleRef = useRef<DirectoryHandle | null>(null)

  /** Best-effort sync of model writes into the bound folder. */
  const mirrorWrites = useCallback(async (files: { path: string; content: string }[]) => {
    if (files.length === 0) return
    try {
      if (isDesktop()) {
        if (folderRef.current) await writeProjectFiles(folderRef.current, files)
      } else if (folderHandleRef.current) {
        await writeViaDirectoryHandle(folderHandleRef.current, files)
      }
    } catch (error) {
      console.warn('Не удалось записать файлы в папку проекта:', error)
    }
  }, [])

  const mirrorDelete = useCallback(async (path: string) => {
    try {
      if (isDesktop()) {
        if (folderRef.current) await deleteProjectFile(folderRef.current, path)
      } else if (folderHandleRef.current) {
        await deleteViaDirectoryHandle(folderHandleRef.current, path)
      }
    } catch (error) {
      console.warn('Не удалось удалить файл из папки проекта:', error)
    }
  }, [])
  /** Real model lists fetched from local providers, keyed by profile id. */
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({})
  const [importing, setImporting] = useState(false)
  const [git, setGit] = useState<GitSummary | null>(null)
  const [browserSessionOpen, setBrowserSessionOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderProfile[]>(loadProviderProfiles)
  const [activeProviderId, setActiveProviderId] = useState(() => loadActiveProviderId())
  // Saved provider lists from older builds may miss entries the current presets
  // define (for example the LM Studio profile), so the defaults always back the
  // saved list up instead of the settings dialog silently offering less.
  const providerList = useMemo(() => {
    const seen = new Set(providers.map((provider) => provider.id))
    const restored = DEFAULT_PROVIDER_PROFILES.filter((provider) => !seen.has(provider.id))
    return [...providers, ...restored]
  }, [providers])
  const activeProvider = providerList.find((provider) => provider.id === activeProviderId) ?? providerList[0]
  // The workspace that was open comes back as it was: a fresh id on every reload
  // is what used to fill the project list with copies of the same project.
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    const saved = readStoredWorkspaces(window.localStorage)
    const activeId = readActiveWorkspaceId(window.localStorage)
    return saved.find((entry) => entry.metadata.id === activeId) ?? createWorkspace(loadState().project)
  })
  // Baseline follows the workspace, not the persisted project: otherwise every
  // reload made the workspace look unmodified and the diff had nothing to show.
  const [baselineProject, setBaselineProject] = useState<Project>(() => workspace.baseline)
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => readStoredWorkspaces(window.localStorage))
  /** Where the tasks are kept: IndexedDB, or localStorage when that is unavailable. */
  const [store, setStore] = useState<ProjectStore | null>(null)
  const workspacesRef = useRef(workspaces)
  const workspaceRef = useRef(workspace)
  /** Hidden file input the archive import reads from. */
  const archiveInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    folderRef.current = workspace.metadata.localPath
  }, [workspace.metadata.localPath])

  // The channel is a function of the project, so every build has its own and a
  // replaced frame cannot answer for the current preview.
  const channel = useMemo(() => channelFor(state.project), [state.project])
  const inspector = useMemo(() => new PreviewInspector(), [])

  const stateRef = useRef(state)
  const projectRef = useRef(state.project)
  /** Mode is read synchronously by send(), so it cannot wait for a re-render. */
  const modeRef = useRef(state.mode)
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    stateRef.current = state
    modeRef.current = state.mode
  }, [state])

  useEffect(() => {
    projectRef.current = state.project
  }, [state.project])

  useEffect(() => saveState(state), [state])

  useEffect(() => {
    workspacesRef.current = workspaces
    workspaceRef.current = workspace
  }, [workspaces, workspace])

  /**
   * Startup: open the project store and adopt whatever it already has. The
   * localStorage copy is rendered first so the rail is never empty, then the
   * real store takes over — and on a first run the visible tasks are written
   * into it.
   */
  useEffect(() => {
    let cancelled = false

    void openProjectStore().then(async (opened) => {
      if (cancelled) return
      setStore(opened)

      let session: Awaited<ReturnType<typeof loadProjectSession>>
      try {
        session = await loadProjectSession(opened)
      } catch {
        return
      }
      if (cancelled) return

      if (session.workspaces.length === 0) {
        await opened.replace(workspacesRef.current)
        await opened.saveActiveId(workspaceRef.current.metadata.id)
        return
      }

      const restored = dedupeWorkspaces(session.workspaces)
      setWorkspaces(restored)
      const active =
        restored.find((entry) => entry.metadata.id === session.activeId) ??
        restored.find((entry) => entry.metadata.id === workspaceRef.current.metadata.id) ??
        restored[0]!
      if (active.metadata.id === workspaceRef.current.metadata.id) return

      projectRef.current = active.project
      setBaselineProject(active.baseline)
      setWorkspace(active)
      dispatch({ type: 'project/set', project: active.project })
    })

    return () => {
      cancelled = true
    }
    // Deliberately once: the store outlives every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const current = { ...workspace, project: state.project, metadata: { ...workspace.metadata, updatedAt: Date.now() } }
    setWorkspace((previous) => previous.project === state.project ? previous : current)
    setWorkspaces((entries) => {
      const next = entries.some((entry) => entry.metadata.id === current.metadata.id)
        ? entries.map((entry) => entry.metadata.id === current.metadata.id ? current : entry)
        : [current, ...entries].slice(0, 12)
      return next
    })
  }, [state.project])

  // Writing is debounced: a turn that rewrites a dozen files is one save, not
  // twelve database transactions.
  useEffect(() => {
    if (!store) return
    const timer = window.setTimeout(() => {
      void store.replace(workspaces).catch(() => {
        /* the session keeps working in memory if the store refuses a write */
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [store, workspaces])

  useEffect(() => {
    void store?.saveActiveId(workspace.metadata.id)
  }, [store, workspace.metadata.id])

  useEffect(() => {
    try {
      localStorage.setItem('freebuff-web:providers', JSON.stringify(providers))
      localStorage.setItem('freebuff-web:active-provider', activeProviderId)
    } catch {
      /* provider settings are a convenience; keep them in memory if storage is unavailable */
    }
  }, [activeProviderId, providers])

  useEffect(() => applyTheme(theme), [theme])

  useEffect(() => inspector.connect(), [inspector])

  // The sidebar reports what the terminal workspace really is — the bound
  // project folder when there is one, the scratch copy otherwise.
  const refreshGit = useCallback(() => {
    const files = projectRef.current.files.map((file) => ({ path: file.path, content: file.content }))
    void readGitState(files, undefined, folderRef.current ?? undefined).then((next) =>
      setGit({
        isRepo: next.isRepo,
        branch: next.branch,
        changes: next.changes.length,
        lastCommit: next.lastCommit,
      }),
    )
  }, [])

  // It runs after a turn lands rather than during one, so a stream of file writes
  // does not spawn a git command each time.
  useEffect(() => {
    if (busy) return
    const timer = window.setTimeout(refreshGit, 1_200)
    return () => window.clearTimeout(timer)
  }, [busy, refreshGit, state.project.files])

  // The Git panel works in the same workspace and says when it changed something.
  useEffect(() => {
    window.addEventListener(GIT_CHANGED_EVENT, refreshGit)
    return () => window.removeEventListener(GIT_CHANGED_EVENT, refreshGit)
  }, [refreshGit])

  // External edits: the shell polls the bound folder, and an event re-reads it.
  // The watcher follows the task's folder, so switching tasks or unbinding
  // stops the old one instead of reporting a folder the user already left.
  useEffect(() => {
    const folder = workspace.metadata.localPath
    if (!folder) return
    let dispose: (() => void) | null = null
    let cancelled = false
    void watchProjectFolder(folder).then((stop) => {
      if (cancelled) stop?.()
      else dispose = stop
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [workspace.metadata.localPath])

  /**
   * Applies what changed on disk without touching anything else. Files the
   * agent is mid-way through writing are left alone: a re-read during a turn
   * would either resurrect an older copy or drop a file that exists in memory
   * but has not been mirrored yet. The git panel is notified afterwards so the
   * status line reflects the same tree the workbench shows.
   */
  useEffect(() => {
    const onFolderChanged = () => {
      const folder = folderRef.current
      if (!folder) return
      // Read refs directly: this fires outside a render, and a stale `busy`
      // here would let a turn's half-written files be overwritten.
      if (busyRef.current) return

      void readProjectFolder(folder)
        .then((source) => {
          const next = planExternalSync({
            current: projectRef.current.files,
            incoming: source.files,
            folder,
            busy: busyRef.current,
          })
          if (next.kind !== 'apply') return
          // `removed` is only populated from a read that produced files, so
          // applying it cannot empty the project.
          for (const path of next.removed) dispatch({ type: 'project/delete', path })
          if (next.changed.length > 0) dispatch({ type: 'project/apply', files: next.changed })
          notifyFolderSynced(folder)
        })
        .catch((error) => console.warn('Не удалось перечитать папку проекта:', error))
    }

    window.addEventListener(FOLDER_CHANGED_EVENT, onFolderChanged)
    return () => window.removeEventListener(FOLDER_CHANGED_EVENT, onFolderChanged)
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV) {
      // Handy when the preview and the inspector disagree about which document is live.
      ;(window as unknown as Record<string, unknown>).__freebuffDebug = { inspector, channel }
    }
  }, [inspector, channel])

  useEffect(() => {
    const controller = new AbortController()
    void fetchAgentConfig(controller.signal).then((config) => {
      dispatch({ type: 'app/meta', configured: config.configured, model: config.model })
    })
    return () => controller.abort()
  }, [])

  // The active profile is what actually travels with every request, so its
  // completeness — not the server's default env config — is what "configured"
  // means in the UI. Without this the label kept saying "not configured" after
  // a local provider was set up, and the composer kept its warning up.
  useEffect(() => {
    const providerReady = Boolean(activeProvider.baseUrl.trim() && activeProvider.model.trim() && (activeProvider.apiKey.trim() || activeProvider.kind === 'ollama' || activeProvider.kind === 'lmstudio'))
    dispatch({ type: 'app/meta', configured: providerReady, model: providerReady ? activeProvider.model : undefined })
  }, [activeProvider])

  // Local providers answer instantly: fetch their model list once so the
  // composer chip can offer real ids without opening Settings.
  useEffect(() => {
    const provider = activeProvider
    const local = provider.kind === 'ollama' || provider.kind === 'lmstudio'
    if (!local || modelLists[provider.id]) return
    let cancelled = false
    void testProvider(provider).then((result) => {
      if (!cancelled && result.ok && result.models.length > 0) {
        setModelLists((current) => ({ ...current, [provider.id]: result.models }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeProvider, modelLists])

  const composerModels = providerList.map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: modelLists[provider.id] ?? [],
  }))

  const applyFiles = useCallback((files: { path: string; content: string }[]) => {
    if (files.length === 0) return
    const next = upsertFiles(projectRef.current, files)
    if (next === projectRef.current) return
    projectRef.current = next
    setWorkspace((current) => ({ ...current, project: next, metadata: { ...current.metadata, updatedAt: Date.now() } }))
    dispatch({ type: 'project/set', project: next })
    // The bound folder is the real home of the project: the model's writes land
    // on disk the moment they are applied, not only when a command runs.
    void mirrorWrites(files)
  }, [mirrorWrites])

  const runProjectChecks = useCallback(async (): Promise<ChecksResult> => {
    setRunningChecks(true)
    try {
      const result = runChecks(projectRef.current)
      dispatch({ type: 'checks/set', result })
      return result
    } finally {
      setRunningChecks(false)
    }
  }, [])

  /**
   * Search-and-replace blocks resolve here, against the project as it stands.
   * `base` is the batch of whole files that lands first (ask mode holds both
   * kinds), so an edit to a file created in the same reply still matches.
   */
  const resolveEdits = useCallback((blocks: EditBlock[], base: ProjectFileInput[]): EditResolution => {
    const writes: ProjectFileInput[] = []
    const failures: { path: string; reason: string }[] = []

    for (const block of blocks) {
      const incoming = base.find((entry) => entry.path === block.path)
      const current = incoming ?? projectRef.current.files.find((entry) => entry.path === block.path)

      if (!current) {
        failures.push({
          path: block.path,
          reason: 'the file does not exist yet — create it with a ```file: block first',
        })
        continue
      }

      const applied = applyEdits(current.content, block.edits)
      if (!applied.ok) failures.push({ path: block.path, reason: applied.reason })
      else writes.push({ path: block.path, content: applied.content })
    }

    return { writes, failures }
  }, [])

  const send = useCallback(
    async (text: string, attachments: AttachmentMeta[], modeOverride?: AgentMode) => {
      if (busyRef.current) return
      const trimmed = text.trim()
      if (!trimmed && attachments.length === 0) return

      const compose = (message: ChatMessage): string => {
        const parts = [message.content.trim()]
        if (message.attachments?.length) parts.push(attachmentsToContext(message.attachments))
        return parts.filter(Boolean).join('\n\n')
      }

      const turns: ChatTurn[] = stateRef.current.messages
        .map((message) => ({ role: message.role, content: compose(message) }) as ChatTurn)
        .filter((turn) => turn.content.length > 0)

      const userTurn: ChatTurn = {
        role: 'user',
        content: [trimmed, attachments.length ? attachmentsToContext(attachments) : '']
          .filter(Boolean)
          .join('\n\n'),
      }

      // The model is stateless, so it is told what the project looks like now.
      userTurn.content = `${userTurn.content}\n\n---\n${projectContext(projectRef.current)}`

      const userMessage: ChatMessage = {
        id: uid('msg'),
        role: 'user',
        content: trimmed,
        attachments: attachments.length ? attachments : undefined,
        createdAt: Date.now(),
      }
      const assistantId = uid('msg')

      dispatch({ type: 'user/send', message: userMessage })
      dispatch({ type: 'assistant/start', id: assistantId })

      busyRef.current = true
      setBusy(true)
      setBudget(null)
      setApproval(null)

      const controller = new AbortController()
      abortRef.current = controller

      // An aborted turn must not wait forever on a pending approval card.
      controller.signal.addEventListener('abort', () => {
        approvalResolver.current?.(false)
        approvalResolver.current = null
        commandApprovalResolver.current?.(false)
        commandApprovalResolver.current = null
      })

      const requestApproval = (files: ProjectFileInput[]) =>
        new Promise<boolean>((resolve) => {
          approvalResolver.current = resolve
          setApproval({ id: uid('appr'), files: files.map((file) => ({ ...file })), status: 'pending' })
        })

      const requestCommandApproval = (command: string) =>
        new Promise<boolean>((resolve) => {
          commandApprovalResolver.current = resolve
          setCommandApproval({ id: uid('appr'), command, status: 'pending' })
        })

      let written: string[] = []
      /** Pre-turn content of every path this turn touches: diff rows and Undo. */
      const beforeImages = new Map<string, string | null>()
      const mode: AgentMode = modeOverride ?? modeRef.current

      const result = await runAgentTurn(
        { turns: [...turns, userTurn], mode, provider: activeProvider },
        {
          onReply: (prose, files) => {
            written = files
            dispatch({ type: 'assistant/set', id: assistantId, content: prose, files: [...files] })
          },
          onFiles: (files) => {
            for (const file of files) {
              if (!beforeImages.has(file.path)) {
                const existing = projectRef.current.files.find((entry) => entry.path === file.path)
                beforeImages.set(file.path, existing ? existing.content : null)
              }
            }
            applyFiles(files)
          },
          onPlan: (items) => dispatch({ type: 'plan/set', items }),
          onBudget: (live, wrappingUp) => setBudget({ budget: live, wrappingUp }),
          onMeta: (config) => {
            dispatch({ type: 'app/meta', configured: config.configured, model: config.model })
          },
          onToolStart: (call) => {
            dispatch({
              type: 'tool/start',
              messageId: assistantId,
              call,
              detail: describeCall(call),
            })
          },
          onToolEnd: (call, outcome: ToolOutcome) => {
            dispatch({ type: 'tool/end', messageId: assistantId, call, outcome })
          },
          execute: (call) => {
            // The agent's commands run through the same dev-server terminal as
            // the panel's, in the bound folder when there is one.
            const runCommand = makeRunCommandHandler({
              files: projectRef.current.files,
              cwd: folderRef.current ?? undefined,
              signal: controller.signal,
            })
            return executeTool(call, { inspector, project: projectRef.current, runCommand })
          },
          requestApproval,
          requestCommandApproval,
          resolveEdits,
        },
        controller.signal,
      )

      // A turn that ended while a card was still pending (abort) leaves nothing clickable.
      setApproval((current) => (current?.status === 'pending' ? null : current))
      setCommandApproval((current) => (current?.status === 'pending' ? null : current))

      const content = pickReplyText({
        prose: result.prose,
        filesWritten: written.length,
        error: result.error,
        ok: result.ok,
        stopped: result.stopped,
      })

      dispatch({
        type: 'assistant/finish',
        id: assistantId,
        status: result.ok || result.stopped ? 'done' : 'error',
        content,
        files: written,
        snapshots: [...beforeImages].map(([path, before]) => ({ path, before })),
      })

      busyRef.current = false
      abortRef.current = null
      setBusy(false)
      setBudget(null)
    },
    [activeProvider, applyFiles, inspector, resolveEdits],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  /** Opens a changed file in the code column; changed files land on their diff. */
  const openFile = useCallback((path: string) => {
    setFocusFile(path)
    setInspectorTab('code')
  }, [])

  /** Opens the project folder in the system file explorer. */
  const revealFolder = useCallback(async () => {
    const folder = workspace.metadata.localPath
    if (!folder) return
    try {
      await revealInExplorer(folder)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось открыть папку.')
    }
  }, [workspace.metadata.localPath])

  const approveFiles = useCallback(() => {
    approvalResolver.current?.(true)
    approvalResolver.current = null
    setApproval(null)
  }, [])

  const approveCommand = useCallback(() => {
    commandApprovalResolver.current?.(true)
    commandApprovalResolver.current = null
    setCommandApproval((current) => (current ? { ...current, status: 'approved' } : current))
  }, [])

  const rejectCommand = useCallback(() => {
    commandApprovalResolver.current?.(false)
    commandApprovalResolver.current = null
    setCommandApproval((current) => (current ? { ...current, status: 'rejected' } : current))
  }, [])

  const rejectFiles = useCallback(() => {
    approvalResolver.current?.(false)
    approvalResolver.current = null
    setApproval((current) => (current ? { ...current, status: 'rejected' } : current))
  }, [])

  /** Reverts the newest turn's writes to their pre-turn content. */
  const undoLastTurn = useCallback((message: ChatMessage) => {
    if (busyRef.current) return
    for (const snapshot of message.snapshots ?? []) {
      if (snapshot.before === null) {
        dispatch({ type: 'project/delete', path: snapshot.path })
        void mirrorDelete(snapshot.path)
      } else {
        dispatch({ type: 'project/write', path: snapshot.path, content: snapshot.before })
        void mirrorWrites([{ path: snapshot.path, content: snapshot.before }])
      }
    }
    dispatch({ type: 'message/undo', id: message.id })
  }, [mirrorDelete, mirrorWrites])

  const setMode = useCallback((mode: AgentMode) => {
    modeRef.current = mode
    dispatch({ type: 'mode/set', mode })
  }, [])

  /** Swaps the open task, project first so every ref agrees. */
  const applyWorkspace = useCallback((next: Workspace) => {
    projectRef.current = next.project
    setBaselineProject(next.baseline)
    setWorkspace(next)
    dispatch({ type: 'project/set', project: next.project })
    setView('workspace')
  }, [])

  /**
   * The bound folder is the real home of the project: switching to a task (or
   * relaunching the app) reads it back, so files edited outside never diverge
   * from what the agent sees. An empty folder keeps the virtual copy — wiping
   * the disk behind the app's back should not delete work.
   */
  const refreshFromFolder = useCallback(async (target: Workspace): Promise<Workspace> => {
    const folder = target.metadata.localPath
    if (!folder) return target
    try {
      let source: ImportedFolder | null = null
      if (isDesktop()) {
        source = await readProjectFolder(folder)
      } else {
        const handle = folderHandleRef.current
        const boundName = folder.split(/[\\/]/).pop()
        // The handle belongs to one folder only; a mismatch would read the wrong tree.
        if (handle && (!boundName || handle.name === boundName)) {
          source = await readViaDirectoryHandle(handle)
        }
      }
      if (!source || source.files.length === 0) return target
      return { ...target, project: projectFromWorkspaceFiles(source.files) }
    } catch (error) {
      console.warn('Не удалось перечитать папку проекта:', error)
      return target
    }
  }, [])

  const switchWorkspace = useCallback((id: string) => {
    const next = workspaces.find((entry) => entry.metadata.id === id)
    if (!next || next.metadata.id === workspace.metadata.id) return
    void refreshFromFolder(next).then(applyWorkspace)
  }, [workspaces, workspace.metadata.id, refreshFromFolder, applyWorkspace])

  // Launch: the open task's folder is read once, so a project edited outside
  // the app starts in sync instead of resurrecting a stale virtual copy.
  const startupRefreshed = useRef(false)
  useEffect(() => {
    if (startupRefreshed.current) return
    startupRefreshed.current = true
    if (workspace.metadata.localPath) {
      void refreshFromFolder(workspace).then((refreshed) => {
        if (refreshed !== workspace) applyWorkspace(refreshed)
      })
    }
    // Deliberately once: against the workspace restored from storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * A new task starts empty and bound to a folder the user picks: everything
   * the model writes lands there. Cancelling the pick keeps the current task.
   */
  const reset = useCallback(async () => {
    if (busyRef.current) return
    if (!window.confirm('Новая задача? Текущий чат останется в истории задач.')) {
      return
    }

    let folder: string | null = null
    let name = 'Новый проект'

    if (isDesktop()) {
      const picked = await pickProjectFolderPath()
      if (!picked) return
      folder = picked
      name = picked.split(/[\\/]/).pop() || name
    } else {
      // The browser binds through a File System Access handle: same mirroring,
      // but the permission lives only for this page session.
      folderHandleRef.current = null
      const picker = (window as unknown as { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker
      if (picker) {
        try {
          const handle = (await picker()) as DirectoryHandle
          folderHandleRef.current = handle
          name = handle.name || name
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return
          // A refused handle still allows a task — just without disk binding.
        }
      }
    }

    const fresh = createInitialState()
    projectRef.current = fresh.project
    inspector.clear()
    setBaselineProject(fresh.project)
    setWorkspace(createWorkspace(emptyProject(), name, folder))
    dispatch({ type: 'app/reset' })
    setView('workspace')
    try {
      localStorage.removeItem('freebuff-web:v1')
    } catch {
      /* nothing to clean up */
    }
  }, [inspector])

  /** Writes the open task to a .rbuilder.json file the user can keep or send. */
  const exportProject = useCallback(async () => {
    const archive = createArchive(workspaceRef.current)
    if (archive.files.length === 0) {
      window.alert('В проекте пока нет файлов.')
      return
    }
    try {
      const result = await saveTextFile(
        archiveFileName(archive.name, archive.exportedAt),
        archiveToText(archive),
      )
      if (!result.saved) window.alert('Файл не сохранён.')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось сохранить проект.')
    }
  }, [])

  const importProject = useCallback(async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed = parseArchive(await readFileAsText(file))
      if (!parsed.ok) {
        window.alert(parsed.error)
        return
      }

      const imported = workspaceFromArchive(parsed.archive)
      // Two archives of the same project must stay two tasks.
      const taken = new Set(workspacesRef.current.map((entry) => entry.metadata.name))
      if (taken.has(imported.metadata.name)) {
        let index = 2
        while (taken.has(`${imported.metadata.name} (${index})`)) index += 1
        imported.metadata.name = `${imported.metadata.name} (${index})`
      }

      setWorkspaces((entries) => [imported, ...entries].slice(0, 12))
      workspaceRef.current = imported
      projectRef.current = imported.project
      setBaselineProject(imported.baseline)
      setWorkspace(imported)
      dispatch({ type: 'project/set', project: imported.project })
      inspector.clear()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Не удалось открыть архив проекта.')
    }
  }, [inspector])

  const openLocalFolder = useCallback(async () => {
    // The desktop shell reads the folder natively: WebView2 has no File System
    // Access API, so the browser path below cannot work there.
    if (isDesktop()) {
      setImporting(true)
      try {
        const folder: ImportedFolder | null = await pickProjectFolder()
        if (folder && folder.files.length > 0) {
          const imported = projectFromWorkspaceFiles(folder.files)
          setBaselineProject(imported)
          // The picked path (not the folder name) is what the mirror, the
          // terminal and the explorer button bind to.
          setWorkspace(createWorkspace(imported, folder.name, folder.path))
          applyFiles(imported.files)
        }
        setView('workspace')
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Не удалось открыть папку.')
      } finally {
        setImporting(false)
      }
      return
    }

    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker
    if (!picker) {
      window.alert('Folder access is not supported by this browser. Use Chrome or Edge.')
      return
    }

    setImporting(true)
    try {
      const root = (await picker()) as {
        name: string
        values: () => AsyncIterable<unknown>
      }
      // The imported folder doubles as the write target for this session.
      folderHandleRef.current = root as unknown as DirectoryHandle
      const imported: { path: string; content: string }[] = []
      const visit = async (directory: { name: string; values: () => AsyncIterable<unknown> }, prefix = ''): Promise<void> => {
        for await (const entry of directory.values()) {
          const item = entry as { kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<unknown> }
          const path = prefix ? `${prefix}/${item.name}` : item.name
          if (path.startsWith('.git/') || path.includes('/node_modules/') || item.name === 'node_modules' || item.name === '.git' || item.name === '.freebuff-workspace') continue
          if (item.kind === 'directory' && item.values) await visit({ name: item.name, values: item.values }, path)
          else if (item.kind === 'file' && item.getFile) {
            const file = await item.getFile()
            if (file.size <= 600_000) imported.push({ path, content: await file.text() })
          }
          if (imported.length >= 60) return
        }
      }
      await visit(root)
      if (imported.length > 0) {
        const importedProject = projectFromWorkspaceFiles(imported)
        setBaselineProject(importedProject)
        // A browser handle has no real path; the session handle does the mirroring.
        setWorkspace(createWorkspace(importedProject, root.name, null))
        applyFiles(importedProject.files)
      }
      setView('workspace')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      window.alert(error instanceof Error ? error.message : 'Не удалось открыть папку.')
    } finally {
      setImporting(false)
    }
  }, [applyFiles])

  const runTerminalCommand = useCallback(
    async (command: string) => {
      const trimmed = command.trim()
      if (!trimmed) return

      dispatch({ type: 'terminal/append', line: { id: uid('term'), kind: 'input', text: `$ ${trimmed}` } })
      dispatch({ type: 'terminal/running', running: true })

      const result = await execCommand(
        trimmed,
        projectRef.current.files,
        (event) => {
        if (event.type === 'stdout' || event.type === 'stderr') {
          dispatch({
            type: 'terminal/append',
            line: { id: uid('term'), kind: event.type, text: event.text },
          })
          return
        }

        if (event.type === 'error') {
          dispatch({
            type: 'terminal/append',
            line: { id: uid('term'), kind: 'error', text: event.message },
          })
          return
        }

        dispatch({
          type: 'terminal/append',
          line: {
            id: uid('term'),
            kind: 'exit',
            text: event.timedOut
              ? `timed out after 20s (exit ${event.code ?? 'none'})`
              : `exited with code ${event.code ?? 'unknown'}`,
          },
        })
        },
        undefined,
        folderRef.current ?? undefined,
      )

      if (!result.ok && result.error && result.error !== 'stopped') {
        dispatch({
          type: 'terminal/append',
          line: { id: uid('term'), kind: 'error', text: result.error },
        })
      }

      dispatch({ type: 'terminal/running', running: false })
    },
    [],
  )

  const [previewDoc, setPreviewDoc] = useState<string>('')
  const [previewBundleError, setPreviewBundleError] = useState<string | null>(null)

  // The preview needs the API address of the desktop shell: its generated apps
  // call `/api/proxy` from an opaque origin, where a relative URL means nothing.
  // A project that imports packages or writes JSX/TS is compiled first; plain
  // projects take the synchronous path and never wait for the compiler.
  useEffect(() => {
    let cancelled = false
    const injection = { channel, script: RUNTIME_SCRIPT, apiBase: apiBase() }
    const plan = planBundle(state.project.files)

    if (plan.entries.length === 0) {
      setPreviewBundleError(null)
      setPreviewDoc(buildPreviewDocument(state.project, injection))
      return
    }

    // Compiling on every keystroke of a stream would queue dozens of wasm
    // builds; the project settles first.
    const timer = window.setTimeout(() => {
      void (async () => {
        const bundles: Record<string, string> = {}
        let failure: { entry: string; error: string } | null = null

        for (const entry of plan.entries) {
          const outcome = await previewBundler()(entry, state.project.files)
          if (outcome.ok) bundles[entry] = outcome.code
          else failure = { entry: outcome.entry, error: outcome.error }
        }

        if (cancelled) return
        setPreviewBundleError(failure ? `${failure.entry}: ${failure.error}` : null)
        setPreviewDoc(
          buildPreviewDocument(state.project, { ...injection, bundles, bundleError: failure }),
        )
      })()
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [state.project, channel])
  const filePaths = useMemo(() => projectFilePaths(state.project), [state.project])
  const indexReady = useMemo(() => hasIndex(state.project), [state.project])

  const askAgentToFix = useCallback(
    (prompt: string) => {
      void send(prompt, [])
    },
    [send],
  )

  const approvePlan = useCallback(() => {
    setMode('build')
    void send(
      'Approved. Build it now, step by step, and keep the checklist updated as you go.',
      [],
      'build',
    )
  }, [send, setMode])

  return (
    <div className="app app--zcode">
      <TaskRail
        workspaces={workspaces.length > 0 ? workspaces : [workspace]}
        activeId={workspace.metadata.id}
        busy={busy}
        git={git}
        checks={state.checks}
        theme={theme}
        importing={importing}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelect={switchWorkspace}
        onNewTask={reset}
        onOpenWorkspace={() => { setActiveNav('workspace'); setView('workspace') }}
        onImportFolder={() => void openLocalFolder()}
        onOpenProjects={() => { setActiveNav('projects'); setView('projects') }}
        onExportProject={() => void exportProject()}
        onImportArchive={() => archiveInputRef.current?.click()}
      />

      <section className="zcode-chat" aria-label="Чат с агентом">
        <header className="zcode-chat-head">
          <h1 className="zcode-chat-title">{workspace.metadata.name}</h1>
          <span className="zcode-chat-badge">
            {state.mode === 'plan'
              ? 'План'
              : state.mode === 'ask'
                ? busy
                  ? 'Ожидает подтверждения…'
                  : 'Подтверждения'
                : busy
                  ? 'Сборка…'
                  : 'Готов'}
          </span>
          <span
            className="zcode-chip"
            title={workspace.metadata.localPath ?? 'Папка не привязана — создайте задачу с папкой'}
          >
            <span aria-hidden="true">▣</span>
            {workspace.metadata.localPath ?? workspace.metadata.name}
          </span>
          {workspace.metadata.localPath && isDesktop() ? (
            <button
              type="button"
              className="zcode-chip-button"
              onClick={() => void revealFolder()}
              title="Открыть в проводнике"
              aria-label="Открыть папку проекта в проводнике"
            >
              ↗
            </button>
          ) : null}
          {git?.branch ? (
            <span className="zcode-chip zcode-chip--branch" title="Ветка терминального воркспейса">
              <span aria-hidden="true">⑂</span>
              {git.branch}
            </span>
          ) : null}
          <div className="zcode-chat-head-end">
            {state.configured && state.model ? <span className="topbar-model">{state.model}</span> : null}
          </div>
        </header>

        <ChatPanel
          messages={state.messages}
          busy={busy}
          budget={budget}
          configured={state.configured}
          mode={state.mode}
          plan={state.plan}
          onModeChange={setMode}
          onApprovePlan={approvePlan}
          onSend={send}
          onStop={stop}
          onOpenSettings={() => setSettingsOpen(true)}
          approval={approval}
          onApproveFiles={approveFiles}
          onRejectFiles={rejectFiles}
          commandApproval={commandApproval}
          onApproveCommand={approveCommand}
          onRejectCommand={rejectCommand}
          files={state.project.files}
          onOpenFile={openFile}
          onUndo={undoLastTurn}
          providerName={activeProvider.name}
          model={state.model ?? activeProvider.model}
          models={composerModels}
          activeProviderId={activeProviderId}
          onProviderChange={setActiveProviderId}
          onModelChange={(model) => {
            setProviders((current) => current.map((entry) => entry.id === activeProviderId ? { ...entry, model } : entry))
            dispatch({ type: 'app/meta', configured: true, model })
          }}
        />
      </section>

      <InspectorPanel
        tab={inspectorTab}
        onTabChange={setInspectorTab}
        project={state.project}
        baselineProject={baselineProject}
        document={previewDoc}
        bundleError={previewBundleError}
        channel={channel}
        filePaths={filePaths}
        hasIndex={indexReady}
        inspector={inspector}
        dockTab={dockTab}
        onDockTabChange={setDockTab}
        checks={state.checks}
        plan={state.plan}
        runningChecks={runningChecks}
        git={git}
        onRunChecks={() => void runProjectChecks()}
        terminal={state.terminal}
        terminalRunning={state.terminalRunning}
        onRunCommand={(command) => void runTerminalCommand(command)}
        onClearTerminal={() => dispatch({ type: 'terminal/clear' })}
        onWriteFile={(path, content) => {
          dispatch({ type: 'project/write', path, content })
          void mirrorWrites([{ path, content }])
        }}
        onDeleteFile={(path) => {
          dispatch({ type: 'project/delete', path })
          void mirrorDelete(path)
        }}
        onAskAgent={askAgentToFix}
        onOpenFile={openFile}
        focusFile={focusFile}
      />

      {browserSessionOpen ? <BrowserSessionPanel onClose={() => setBrowserSessionOpen(false)} /> : null}
      <input
        ref={archiveInputRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void importProject(file)
        }}
      />
      {settingsOpen ? (
        <SettingsPanel
          profiles={providerList}
          activeId={activeProviderId}
          onActiveChange={setActiveProviderId}
          onSave={(profile) => setProviders((current) => {
            const exists = current.some((entry) => entry.id === profile.id)
            return exists
              ? current.map((entry) => entry.id === profile.id ? profile : entry)
              : [...current, profile]
          })}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  )
}

function loadProviderProfiles(): ProviderProfile[] {
  try {
    const raw = localStorage.getItem('freebuff-web:providers')
    if (raw) {
      const parsed = JSON.parse(raw) as ProviderProfile[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    /* use defaults */
  }
  return DEFAULT_PROVIDER_PROFILES
}

function pickReplyText(input: {
  prose: string
  filesWritten: number
  error?: string
  ok: boolean
  stopped: boolean
}): string {
  const prose = input.prose.trim()
  if (prose) return prose
  if (input.stopped) return 'Stopped.'
  if (input.error) return input.error
  if (input.filesWritten > 0) {
    return input.filesWritten === 1 ? 'Wrote 1 file.' : `Wrote ${input.filesWritten} files.`
  }
  return input.ok ? 'Done.' : 'No response.'
}

function loadActiveProviderId(): string {
  try {
    return localStorage.getItem('freebuff-web:active-provider') ?? 'openai'
  } catch {
    return 'openai'
  }
}
