import type { Project, ProjectFile } from './project'

export type WorkspaceMode = 'ask' | 'plan' | 'edit' | 'debug' | 'review' | 'run' | 'commit'

export type WorkspaceMetadata = {
  id: string
  name: string
  localPath: string | null
  architecture: string | null
  activeBranch: string
  agentRules: string
  environmentProfile: string
  connectedRepository: string | null
  createdAt: number
  updatedAt: number
}

export type Workspace = {
  metadata: WorkspaceMetadata
  project: Project
  baseline: Project
  mode: WorkspaceMode
}

export type WorkspaceRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped'
export type WorkspaceRunStep = 'context' | 'planner' | 'file-search' | 'editor' | 'typecheck' | 'reviewer' | 'diff-ready'

export type WorkspaceRun = {
  id: string
  workspaceId: string
  prompt: string
  status: WorkspaceRunStatus
  steps: { name: WorkspaceRunStep; status: 'pending' | 'running' | 'completed' | 'failed' }[]
  startedAt: number
  finishedAt?: number
}

export const WORKSPACE_STORAGE_KEY = 'freebuff-workspaces:v1'
export const WORKSPACE_IGNORES = ['.git', 'node_modules', '.freebuff-workspace', '.rbuilder/cache']

export function createWorkspace(project: Project, name = 'Untitled project', localPath: string | null = null): Workspace {
  const now = Date.now()
  const baseline = cloneProject(project)
  return {
    metadata: {
      // Two workspaces created in the same millisecond still need distinct ids.
      id: `workspace_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      localPath,
      architecture: null,
      activeBranch: 'main',
      agentRules: '',
      environmentProfile: 'local',
      connectedRepository: null,
      createdAt: now,
      updatedAt: now,
    },
    project,
    baseline,
    mode: 'edit',
  }
}

export function cloneProject(project: Project): Project {
  return { files: project.files.map((file) => ({ ...file })) }
}

export function shouldIgnoreWorkspacePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  return WORKSPACE_IGNORES.some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`)) ||
    normalized === '.env' || normalized.startsWith('.env.')
}

export function projectFromWorkspaceFiles(files: ProjectFile[]): Project {
  return { files: files.filter((file) => !shouldIgnoreWorkspacePath(file.path)) }
}

export function changedWorkspaceFiles(workspace: Workspace): ProjectFile[] {
  const before = new Map(workspace.baseline.files.map((file) => [file.path, file.content]))
  return workspace.project.files.filter((file) => before.get(file.path) !== file.content)
}

/** Which workspace was open, so a reload does not invent a new one. */
export const ACTIVE_WORKSPACE_STORAGE_KEY = 'rbuilder-workspaces:active'

export type WorkspaceStorage = Pick<Storage, 'getItem'>
export type WritableWorkspaceStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Two workspaces with the same name and the same files are the same workspace:
 * a reload used to append a copy of the open project on every visit.
 */
export function workspaceSignature(workspace: Workspace): string {
  return JSON.stringify([workspace.metadata.name, workspace.project.files])
}

export function dedupeWorkspaces(entries: Workspace[]): Workspace[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = workspaceSignature(entry)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Reads the saved workspace list, keeping only entries that look intact. */
export function readStoredWorkspaces(storage: WorkspaceStorage): Workspace[] {
  try {
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Workspace[]
    if (!Array.isArray(parsed)) return []
    return dedupeWorkspaces(parsed.filter((entry) => entry?.metadata?.id && entry.project?.files))
  } catch {
    return []
  }
}

export function readActiveWorkspaceId(storage: WorkspaceStorage): string | null {
  try {
    return storage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function rememberActiveWorkspace(storage: WritableWorkspaceStorage, id: string): void {
  try {
    storage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id)
  } catch {
    /* the history is a convenience; keep working in memory */
  }
}

export function saveStoredWorkspaces(storage: WritableWorkspaceStorage, entries: Workspace[]): void {
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* local-only history */
  }
}
