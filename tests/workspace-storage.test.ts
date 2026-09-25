import { describe, expect, it } from 'vitest'
import { createStarterProject } from '../src/lib/project'
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  createWorkspace,
  dedupeWorkspaces,
  readActiveWorkspaceId,
  readStoredWorkspaces,
  rememberActiveWorkspace,
  saveStoredWorkspaces,
  WORKSPACE_STORAGE_KEY,
  workspaceSignature,
} from '../src/lib/workspace'

/** A stand-in for localStorage, which does not exist in the node test environment. */
function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    dump: () => Object.fromEntries(data),
  }
}

describe('workspace storage', () => {
  it('round-trips a workspace list', () => {
    const storage = memoryStorage()
    const workspace = createWorkspace(createStarterProject(), 'shop')
    saveStoredWorkspaces(storage, [workspace])

    const restored = readStoredWorkspaces(storage)
    expect(restored).toHaveLength(1)
    expect(restored[0]!.metadata.name).toBe('shop')
    expect(restored[0]!.project.files).toHaveLength(workspace.project.files.length)
  })

  it('survives unreadable or malformed storage', () => {
    expect(readStoredWorkspaces(memoryStorage({ [WORKSPACE_STORAGE_KEY]: '{not json' }))).toEqual([])
    expect(readStoredWorkspaces(memoryStorage({ [WORKSPACE_STORAGE_KEY]: '{"a":1}' }))).toEqual([])
    expect(readStoredWorkspaces(memoryStorage({ [WORKSPACE_STORAGE_KEY]: '[{"metadata":{}}]' }))).toEqual([])
  })

  it('keeps one entry when a reload copied the open project', () => {
    const project = createStarterProject()
    const first = createWorkspace(project, 'Untitled project')
    const second = createWorkspace(project, 'Untitled project')
    expect(second.metadata.id).not.toBe(first.metadata.id)
    expect(workspaceSignature(first)).toBe(workspaceSignature(second))
    expect(dedupeWorkspaces([first, second])).toHaveLength(1)
  })

  it('keeps genuinely different projects apart', () => {
    const a = createWorkspace(createStarterProject(), 'shop')
    const other = createStarterProject()
    other.files[0]!.content = `${other.files[0]!.content}\n<!-- changed -->`
    const b = createWorkspace(other, 'shop')
    expect(dedupeWorkspaces([a, b])).toHaveLength(2)
  })

  it('remembers which workspace was open', () => {
    const storage = memoryStorage()
    expect(readActiveWorkspaceId(storage)).toBeNull()
    rememberActiveWorkspace(storage, 'workspace_abc')
    expect(readActiveWorkspaceId(storage)).toBe('workspace_abc')
    expect(storage.dump()[ACTIVE_WORKSPACE_STORAGE_KEY]).toBe('workspace_abc')
  })
})
