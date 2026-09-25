import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { CodeWorkbench } from './components/CodeWorkbench'
import { DesktopHome } from './components/DesktopHome'
import { SettingsPanel } from './components/SettingsPanel'
import { BrowserSessionPanel } from './components/BrowserSessionPanel'
import { PreviewPane, type DockTab } from './components/PreviewPane'
import { DEFAULT_PROVIDER_PROFILES, execCommand, fetchAgentConfig, type ProviderProfile } from './lib/agent'
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
import { createWorkspace, projectFromWorkspaceFiles, type Workspace } from './lib/workspace'
import { describeCall, executeTool, type ToolOutcome } from './lib/tools'
import { runAgentTurn } from './lib/turn'
import type { AgentMode, ChatTurn } from './lib/protocol'
import {
  createInitialState,
  loadState,
  reducer,
  saveState,
  uid,
  type ChatMessage,
} from './lib/store'

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [busy, setBusy] = useState(false)
  /** Live for the duration of one turn: how much time and token budget is left. */
  const [budget, setBudget] = useState<{ budget: Budget; wrappingUp: boolean } | null>(null)
  const [dockTab, setDockTab] = useState<DockTab>('files')
  const [runningChecks, setRunningChecks] = useState(false)
  const [view, setView] = useState<'home' | 'workspace'>('home')
  const [activeNav, setActiveNav] = useState<'home' | 'projects' | 'templates' | 'agents' | 'deployments' | 'settings'>('home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [browserSessionOpen, setBrowserSessionOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderProfile[]>(loadProviderProfiles)
  const [activeProviderId, setActiveProviderId] = useState(() => loadActiveProviderId())
  const [baselineProject, setBaselineProject] = useState<Project>(() => loadState().project)
  const [workspace, setWorkspace] = useState<Workspace>(() => createWorkspace(loadState().project))
  const [workspaces, setWorkspaces] = useState<Workspace[]>(loadSavedWorkspaces)

  // The channel is a function of the project, so every build has its own and a
  // replaced frame cannot answer for the current preview.
  const channel = useMemo(() => channelFor(state.project), [state.project])
  const inspector = useMemo(() => new PreviewInspector(), [])
  const activeProvider = providers.find((provider) => provider.id === activeProviderId) ?? providers[0]

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
      try { localStorage.setItem('rbuilder-workspaces:v1', JSON.stringify(next)) } catch { /* local-only history */ }
      return next
    })
  }, [state.project])

  useEffect(() => {
    try {
      localStorage.setItem('freebuff-web:providers', JSON.stringify(providers))
      localStorage.setItem('freebuff-web:active-provider', activeProviderId)
    } catch {
      /* provider settings are a convenience; keep them in memory if storage is unavailable */
    }
  }, [activeProviderId, providers])

  useEffect(() => inspector.connect(), [inspector])

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
      const mode: AgentMode = modeOverride ?? modeRef.current

      const result = await runAgentTurn(
        { turns: [...turns, userTurn], mode, provider: activeProvider },
        {
          onReply: (prose, files) => {
            written = files
            dispatch({ type: 'assistant/set', id: assistantId, content: prose, files: [...files] })
          },
          onFiles: applyFiles,
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
      })

      busyRef.current = false
      abortRef.current = null
      setBusy(false)
      setBudget(null)
    },
    [activeProvider, applyFiles, inspector],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

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

  const changeBranch = useCallback((branch: string) => {
    setWorkspace((current) => {
      const next = { ...current, metadata: { ...current.metadata, activeBranch: branch, updatedAt: Date.now() } }
      setWorkspaces((entries) => {
        const saved = entries.map((entry) => entry.metadata.id === next.metadata.id ? next : entry)
        try { localStorage.setItem('rbuilder-workspaces:v1', JSON.stringify(saved)) } catch { /* local-only history */ }
        return saved
      })
      return next
    })
  }, [])

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
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker
    if (!picker) {
      window.alert('Folder access is not supported by this browser. Use Chrome or Edge.')
      return
    }

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
      window.alert(error instanceof Error ? error.message : 'Could not open the folder.')
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

  const deployProject = useCallback(() => {
    setView('workspace')
    setDockTab('terminal')
    void runTerminalCommand('pnpm build')
  }, [runTerminalCommand])

  const previewDocument = useMemo(
    () => buildPreviewDocument(state.project, { channel, script: RUNTIME_SCRIPT }),
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
    <div className="app">
      <aside className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`} aria-label="RBUILDER navigation">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-name">RBUILDER</span>
          <button type="button" className="sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? 'Показать боковую панель' : 'Скрыть боковую панель'} title={sidebarCollapsed ? 'Показать панель' : 'Скрыть панель'}>{sidebarCollapsed ? '→' : '←'}</button>
        </div>          <button type="button" className="new-project" onClick={reset} disabled={busy}>
          <span aria-hidden="true">＋</span>
          Новый проект
          <span className="new-project-shortcut">⌘ N</span>
        </button>

        <nav className="sidebar-nav" aria-label="RBUILDER Desktop">
          <span className="sidebar-label">Рабочая область</span>
          <button type="button" className={`sidebar-link sidebar-link--button${activeNav === 'home' ? ' sidebar-link--active' : ''}`} onClick={() => { setActiveNav('home'); setView('home') }}>
            <span className="sidebar-icon" aria-hidden="true">⌂</span> Главная
          </button>
          <button type="button" className={`sidebar-link sidebar-link--button${activeNav === 'projects' ? ' sidebar-link--active' : ''}`} onClick={() => { setActiveNav('projects'); setView('workspace') }}>
            <span className="sidebar-icon" aria-hidden="true">▣</span> Проекты
          </button>
          <button type="button" className={`sidebar-link sidebar-link--button${activeNav === 'templates' ? ' sidebar-link--active' : ''}`} onClick={() => { setActiveNav('templates'); void openLocalFolder() }} disabled={busy}>
            <span className="sidebar-icon" aria-hidden="true">◇</span> Открыть папку
          </button>
          <button type="button" className={`sidebar-link sidebar-link--button${activeNav === 'agents' ? ' sidebar-link--active' : ''}`} onClick={() => { setActiveNav('agents'); setView('home') }}>
            <span className="sidebar-icon" aria-hidden="true">♙</span> Агенты
          </button>
          <button type="button" className={`sidebar-link sidebar-link--button${activeNav === 'deployments' ? ' sidebar-link--active' : ''}`} onClick={() => { setActiveNav('deployments'); deployProject() }} disabled={busy}>
            <span className="sidebar-icon" aria-hidden="true">◇</span> Публикации
          </button>
          <button type="button" className={`sidebar-link sidebar-link--button${activeNav === 'settings' ? ' sidebar-link--active' : ''}`} onClick={() => { setActiveNav('settings'); setSettingsOpen(true) }}>
            <span className="sidebar-icon" aria-hidden="true">⚙</span> Настройки
          </button>
        </nav>

        <section className="sidebar-project-card" aria-label="Текущий проект">
          <span className="sidebar-label">Текущий проект</span>
          <label className="sidebar-project-switcher"><span className="project-mini-icon">R</span><select aria-label="Выбрать проект" value={workspace.metadata.id} onChange={(event) => switchWorkspace(event.target.value)}>{workspaces.map((entry) => <option key={entry.metadata.id} value={entry.metadata.id}>{entry.metadata.name}</option>)}</select></label>
          <button type="button" className="sidebar-project-open" onClick={() => setView('workspace')}><strong>{workspace.metadata.name}</strong><small>{workspace.metadata.localPath ?? 'Локальный workspace'}</small></button>
          <label className="sidebar-branch"><span>Ветка</span><select value={workspace.metadata.activeBranch} onChange={(event) => changeBranch(event.target.value)}><option>main</option><option>develop</option><option>feature/rbuilder</option></select></label>
          <button type="button" className="sidebar-preview-status" onClick={() => { setView('workspace'); setDockTab('files') }}><span className="status-dot status-dot--ready" /> Живой просмотр <span>→</span></button>
          <div className="sidebar-preview-url"><span className="status-dot status-dot--ready" /> https://localhost:5174</div>
          <div className="sidebar-build"><span>Сборка</span><strong><i /> {state.checks ? 'Успешно' : 'Готово'}</strong></div>
          <div className="sidebar-build-meta"><span>Последний коммит</span><span>сейчас</span></div>
        </section>

        <div className="sidebar-bottom">
          <button type="button" className="sidebar-link sidebar-link--button" onClick={() => setBrowserSessionOpen(true)}><span className="sidebar-icon" aria-hidden="true">◉</span> Сессии браузера</button>
          <div className="sidebar-credits"><span>Кредиты ИИ</span><strong>Локально</strong><div className="credits-track"><i /></div></div>
        </div>
      </aside>
      {sidebarCollapsed ? <button type="button" className="sidebar-reopen" onClick={() => setSidebarCollapsed(false)} aria-label="Показать боковую панель" title="Показать боковую панель">→</button> : null}

      <main className="main-shell" id="workspace">
        {view === 'home' ? (
          <DesktopHome
            project={workspace.project}
            configured={state.configured}
            model={state.model ?? null}
            onOpenWorkspace={() => setView('workspace')}
            onNewProject={reset}
          />
        ) : (
          <>
            <header className="topbar">
              <div className="breadcrumb">
                <span className="breadcrumb-muted">Проекты</span>
                <span aria-hidden="true">/</span>
                <strong>{workspace.metadata.name}</strong>
              </div>

              <div className="topbar-end">
                <span className="topbar-mode">Web builder</span>
                {state.configured && state.model ? <span className="topbar-model">{state.model}</span> : null}
              </div>
            </header>

            <div className="ide-workspace">
              <div className="ide-chat-column">
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
                />
              </div>
              <CodeWorkbench project={state.project} onWriteFile={(path, content) => dispatch({ type: 'project/write', path, content })} />
              <div className="ide-preview-column">
                <PreviewPane
                  document={previewDocument}
                  channel={channel}
                  files={filePaths}
                  project={state.project}
                  baselineProject={baselineProject}
                  hasIndex={indexReady}
                  inspector={inspector}
                  tab={dockTab}
                  onTabChange={setDockTab}
                  checks={state.checks}
                  runningChecks={runningChecks}
                  onRunChecks={() => void runProjectChecks()}
                  terminal={state.terminal}
                  terminalRunning={state.terminalRunning}
                  onRunCommand={(command) => void runTerminalCommand(command)}
                  onClearTerminal={() => dispatch({ type: 'terminal/clear' })}
                  onWriteFile={(path, content) => dispatch({ type: 'project/write', path, content })}
                  onDeleteFile={(path) => dispatch({ type: 'project/delete', path })}
                  onAskAgent={askAgentToFix}
                />
              </div>
            </div>
          </>
        )}
      </main>
      {browserSessionOpen ? <BrowserSessionPanel onClose={() => setBrowserSessionOpen(false)} /> : null}
      {settingsOpen ? (
        <SettingsPanel
          profiles={providers}
          activeId={activeProviderId}
          onActiveChange={setActiveProviderId}
          onSave={(profile) => setProviders((current) => current.map((entry) => entry.id === profile.id ? profile : entry))}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  )
}

function loadSavedWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem('rbuilder-workspaces:v1')
    if (!raw) return []
    const parsed = JSON.parse(raw) as Workspace[]
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.metadata?.id && entry.project?.files) : []
  } catch {
    return []
  }
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

function loadActiveProviderId(): string {
  try {
    return localStorage.getItem('freebuff-web:active-provider') ?? 'openai'
  } catch {
    return 'openai'
  }
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
