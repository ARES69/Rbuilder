/**
 * Where the tasks live.
 *
 * localStorage is the wrong home for this: a task is up to 40 files of half a
 * megabyte each, and a browser hands out about five megabytes in total.
 * IndexedDB stores the same records without that ceiling, so the list of
 * projects moves there first and the chat transcript can follow.
 *
 * The fallback chain is deliberate. IndexedDB is unavailable in private modes
 * and on some file:// origins; there localStorage keeps the app usable, and
 * with neither the session works in memory. Existing localStorage tasks are
 * migrated once, on the first run after the upgrade.
 */

import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  readActiveWorkspaceId,
  readStoredWorkspaces,
  saveStoredWorkspaces,
  type Workspace,
} from './workspace'

export const DATABASE_NAME = 'rbuilder-projects'
export const DATABASE_VERSION = 1
const STORE = 'workspaces'
const SETTINGS = 'settings'
const ACTIVE_KEY = 'active'
const MIGRATED_KEY = 'migrated'

export type StoreKind = 'indexeddb' | 'localstorage' | 'memory'

export type ProjectStore = {
  kind: StoreKind
  /** Every saved task, most recently updated first is the caller's business. */
  load: () => Promise<Workspace[]>
  /** Replaces the saved list with these entries. */
  replace: (entries: Workspace[]) => Promise<void>
  loadActiveId: () => Promise<string | null>
  saveActiveId: (id: string | null) => Promise<void>
}

/** The smallest surface the store needs, so tests can pass a fake. */
export type StoreEnvironment = {
  indexedDB?: IDBFactory | null
  storage?: Storage | null
}

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'metadata.id' })
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'))
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another window.'))
  })
}

function readAll(db: IDBDatabase): Promise<Workspace[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    request.onsuccess = () => resolve((request.result ?? []) as Workspace[])
    request.onerror = () => reject(request.error ?? new Error('The projects could not be read.'))
  })
}

function readSetting(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(SETTINGS, 'readonly').objectStore(SETTINGS).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The setting could not be read.'))
  })
}

function writeAll(db: IDBDatabase, entries: Workspace[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    store.clear()
    for (const entry of entries) store.put(entry)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('The projects could not be saved.'))
  })
}

function writeSetting(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS, 'readwrite')
    transaction.objectStore(SETTINGS).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('The setting could not be saved.'))
  })
}

function indexedDbStore(db: IDBDatabase): ProjectStore {
  return {
    kind: 'indexeddb',
    load: () => readAll(db),
    replace: (entries) => writeAll(db, entries),
    loadActiveId: async () => {
      const value = await readSetting(db, ACTIVE_KEY)
      return typeof value === 'string' ? value : null
    },
    saveActiveId: (id) => writeSetting(db, ACTIVE_KEY, id),
  }
}

/* ------------------------------------------------------------------ */
/* Fallbacks                                                           */
/* ------------------------------------------------------------------ */

function localStorageStore(storage: Storage): ProjectStore {
  return {
    kind: 'localstorage',
    load: async () => readStoredWorkspaces(storage),
    replace: async (entries) => saveStoredWorkspaces(storage, entries),
    loadActiveId: async () => readActiveWorkspaceId(storage),
    saveActiveId: async (id) => {
      if (id) {
        try {
          storage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id)
        } catch {
          /* remembering the open task is a convenience */
        }
      } else {
        storage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY)
      }
    },
  }
}

function memoryStore(seed: Workspace[]): ProjectStore {
  let entries = seed
  let activeId: string | null = null

  return {
    kind: 'memory',
    load: async () => entries,
    replace: async (next) => {
      entries = next
    },
    loadActiveId: async () => activeId,
    saveActiveId: async (id) => {
      activeId = id
    },
  }
}

/* ------------------------------------------------------------------ */
/* Opening                                                             */
/* ------------------------------------------------------------------ */

/**
 * Opens the best store available. IndexedDB is tried first; if it fails, the
 * tasks already in localStorage keep the app usable; with neither, the session
 * simply holds its projects in memory.
 */
export async function openProjectStore(env: StoreEnvironment = {}): Promise<ProjectStore> {
  const factory = env.indexedDB ?? (typeof indexedDB === 'undefined' ? null : indexedDB)
  const storage = env.storage ?? (typeof localStorage === 'undefined' ? null : localStorage)

  if (factory) {
    try {
      const db = await openDatabase(factory)
      const store = indexedDbStore(db)

      // One-time migration of the tasks that predate IndexedDB.
      if (storage && !(await readSetting(db, MIGRATED_KEY))) {
        const legacy = readStoredWorkspaces(storage)
        if (legacy.length > 0) await writeAll(db, legacy)
        const legacyActive = readActiveWorkspaceId(storage)
        if (legacyActive) await writeSetting(db, ACTIVE_KEY, legacyActive)
        await writeSetting(db, MIGRATED_KEY, Date.now())
      }

      return store
    } catch {
      /* fall through to the next storage */
    }
  }

  if (storage) return localStorageStore(storage)
  return memoryStore([])
}

/** The tasks and which one was open: what a session needs at startup. */
export async function loadProjectSession(store: ProjectStore): Promise<{
  workspaces: Workspace[]
  activeId: string | null
}> {
  const [workspaces, activeId] = await Promise.all([store.load(), store.loadActiveId()])
  return { workspaces, activeId }
}