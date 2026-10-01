import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { InspectorPanel, type InspectorTab } from './components/InspectorPanel'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { BrowserSessionPanel } from './components/BrowserSessionPanel'
import { TaskRail } from './components/TaskRail'
import type { DockTab } from './components/PreviewPane'
import { DEFAULT_PROVIDER_PROFILES, execCommand, fetchAgentConfig, testProvider, type ProviderProfile } from './lib/agent'
import { apiBase, isDesktop } from './lib/apiBase'
import { pickProjectFolder, type ImportedFolder } from './lib/desktop'
import { GIT_CHANGED_EVENT, readGitState } from './lib/git'
import { attachmentsToContext, type AttachmentMeta } from './lib/attachments'
import type { Budget } from './lib/budget'
import { runChecks, type ChecksResult } from './lib/checks'
import { channelFor, PreviewInspector } from './lib/inspector'
import {
  buildPreviewDocument,
  hasIndex,
  projectContext,
  projectFilePaths,
  upsertFiles,
  type Project,
} from './lib/project'
import { RUNTIME_SCRIPT } from './lib/previewRuntime'
import {
  createWorkspace,
  projectFromWorkspaceFiles,
  readActiveWorkspaceId,
  readStoredWorkspaces,
  rememberActiveWorkspace,
  saveStoredWorkspaces,
  type Workspace,
} from './lib/workspace'
import { describeCall, executeTool, type ToolOutcome } from './lib/tools'
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
  const [baselineProject, setBaselineProject] = useState<Project>(() => loadState().project)
  // The workspace that was open comes back as it was: a fresh id on every reload
  // is what used to fill the project list with copies of the same project.
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    const saved = readStoredWorkspaces(window.localStorage)
    const activeId = readActiveWorkspaceId(window.localStorage)
    return saved.find((entry) => entry.metadata.id === activeId) ?? createWorkspace(loadState().project)
  })
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => readStoredWorkspaces(window.localStorage))

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
    const current = { ...workspace, project: state.project, metadata: { ...workspace.metadata, updatedAt: Date.now() } }
    setWorkspace((previous) => previous.project === state.project ? previous : current)
    setWorkspaces((entries) => {
      const next = entries.some((entry) => entry.metadata.id === current.metadata.id)
        ? entries.map((entry) => entry.metadata.id === current.metadata.id ? current : entry)
        : [current, ...entries].slice(0, 12)
      saveStoredWorkspaces(window.localStorage, next)
      return next
    })
  }, [state.project])

  useEffect(() => rememberActiveWorkspace(window.localStorage, workspace.metadata.id), [workspace.metadata.id])

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

  // The sidebar reports what the terminal workspace really is.
  const refreshGit = useCallback(() => {
    const files = projectRef.current.files.map((file) => ({ path: file.path, content: file.content }))
    void readGitState(files).then((next) =>
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
  }, [])

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

      const controller = new AbortController()
      abortRef.current = controller

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
          execute: (call) =>
            executeTool(call, { inspector, project: projectRef.current }),
        },
        controller.signal,
      )

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
    [activeProvider, applyFiles, inspector],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  /** Reverts the newest turn's writes to their pre-turn content. */
  const undoLastTurn = useCallback((message: ChatMessage) => {
    if (busyRef.current) return
    for (const snapshot of message.snapshots ?? []) {
      if (snapshot.before === null) dispatch({ type: 'project/delete', path: snapshot.path })
      else dispatch({ type: 'project/write', path: snapshot.path, content: snapshot.before })
    }
    dispatch({ type: 'message/undo', id: message.id })
  }, [])

  const setMode = useCallback((mode: AgentMode) => {
    modeRef.current = mode
    dispatch({ type: 'mode/set', mode })
  }, [])

  const switchWorkspace = useCallback((id: string) => {
    const next = workspaces.find((entry) => entry.metadata.id === id)
    if (!next || next.metadata.id === workspace.metadata.id) return
    projectRef.current = next.project
    setBaselineProject(next.baseline)
    setWorkspace(next)
    dispatch({ type: 'project/set', project: next.project })
    setView('workspace')
  }, [workspaces, workspace.metadata.id])

  const reset = useCallback(() => {
    if (busyRef.current) return
    if (!window.confirm('Start a new project? The chat and the generated files will be cleared.')) {
      return
    }
    const fresh = createInitialState()
    projectRef.current = fresh.project
    inspector.clear()
    setBaselineProject(fresh.project)
    setWorkspace(createWorkspace(fresh.project, 'Новый проект', null))
    dispatch({ type: 'app/reset' })
    setView('workspace')
    try {
      localStorage.removeItem('freebuff-web:v1')
    } catch {
      /* nothing to clean up */
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
          setWorkspace(createWorkspace(imported, folder.name, folder.name))
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
        setWorkspace(createWorkspace(importedProject, root.name, root.name))
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

      const result = await execCommand(trimmed, projectRef.current.files, (event) => {
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
      })

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

  const previewDocument = useMemo(
    // The preview needs the API address of the desktop shell: its generated apps
    // call `/api/proxy` from an opaque origin, where a relative URL means nothing.
    () => buildPreviewDocument(state.project, { channel, script: RUNTIME_SCRIPT, apiBase: apiBase() }),
    [state.project, channel],
  )
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
      />

      <section className="zcode-chat" aria-label="Чат с агентом">
        <header className="zcode-chat-head">
          <h1 className="zcode-chat-title">{workspace.metadata.name}</h1>
          <span className="zcode-chat-badge">{state.mode === 'plan' ? 'План' : busy ? 'Сборка…' : 'Готов'}</span>
          <span className="zcode-chip" title="Папка проекта">
            <span aria-hidden="true">▣</span>
            {workspace.metadata.localPath
              ? workspace.metadata.localPath.split(/[\\/]/).pop()
              : workspace.metadata.name}
          </span>
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
          files={state.project.files}
          onOpenFile={() => {
            setInspectorTab('code')
            setDockTab('files')
          }}
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
        document={previewDocument}
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
        onWriteFile={(path, content) => dispatch({ type: 'project/write', path, content })}
        onDeleteFile={(path) => dispatch({ type: 'project/delete', path })}
        onAskAgent={askAgentToFix}
      />

      {browserSessionOpen ? <BrowserSessionPanel onClose={() => setBrowserSessionOpen(false)} /> : null}
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
