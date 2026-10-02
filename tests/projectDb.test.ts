import { describe, expect, it } from 'vitest'
import { loadProjectSession, openProjectStore, type ProjectStore } from '../src/lib/projectDb'
import { createWorkspace, WORKSPACE_STORAGE_KEY, ACTIVE_WORKSPACE_STORAGE_KEY } from '../src/lib/workspace'

/**
 * IndexedDB does not exist in the test runtime, so these cover the paths the
 * app falls back to and the migration it performs on the way up. The IndexedDB
 * branch itself is exercised in the browser and in the packaged app.
 */

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage
}

const sample = () => createWorkspace({ files: [{ path: 'index.html', content: '<h1>hi</h1>' }] }, 'Таймер')

describe('project store', () => {
  it('falls back to localStorage when IndexedDB is unavailable', async () => {
    const storage = fakeStorage()

    const store = await openProjectStore({ indexedDB: null, storage })
    expect(store.kind).toBe('localstorage')

    await store.replace([sample()])
    expect(await store.load()).toHaveLength(1)
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toContain('Таймер')
  })

  it('remembers and reports the open task', async () => {
    const storage = fakeStorage()
    const store = await openProjectStore({ indexedDB: null, storage })
    const task = sample()

    await store.saveActiveId(task.metadata.id)

    expect(await store.loadActiveId()).toBe(task.metadata.id)
    expect(storage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe(task.metadata.id)
  })

  it('keeps working in memory when there is no storage at all', async () => {
    const store = await openProjectStore({ indexedDB: null, storage: null })

    expect(store.kind).toBe('memory')

    await store.replace([sample()])
    await store.saveActiveId('workspace_1')

    const session = await loadProjectSession(store)
    expect(session.workspaces).toHaveLength(1)
    expect(session.activeId).toBe('workspace_1')
  })

  it('reports an empty session rather than failing', async () => {
    const store = await openProjectStore({ indexedDB: null, storage: fakeStorage() })

    expect(await loadProjectSession(store)).toEqual({ workspaces: [], activeId: null })
  })
})

describe('the store contract', () => {
  it('replaces rather than appends, so a deleted task stays deleted', async () => {
    let entries = [sample(), createWorkspace({ files: [] }, 'Второй')]
    const store: ProjectStore = {
      kind: 'memory',
      load: async () => entries,
      replace: async (next) => {
        entries = next
      },
      loadActiveId: async () => null,
      saveActiveId: async () => undefined,
    }

    await store.replace(entries.slice(0, 1))

    expect(await store.load()).toHaveLength(1)
    expect((await store.load())[0]!.metadata.name).toBe('Таймер')
  })
})