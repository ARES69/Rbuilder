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
      id: `workspace_${now.toString(36)}`,
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
