/**
 * Watching the bound project folder.
 *
 * The desktop shell polls the folder and emits an event when the tree changes
 * (`watch_project_folder` / `unwatch_project_folder` in the Rust shell). This
 * module is the front-end half: it turns the raw notification into a decision
 * about what to do with the current project.
 *
 * The interesting part is `planExternalSync`, which is deliberately pure. A
 * folder change can arrive while the agent is mid-turn, and blindly re-reading
 * would resurrect a half-written file or drop a file the model has just created
 * in memory but not yet on disk. So the re-read is compared against what the
 * app already holds, and only the real differences are applied.
 */

import { isDesktop } from './apiBase'
import type { ImportedFile } from './desktop'
import type { ProjectFile } from './project'
import { shouldIgnoreWorkspacePath } from './workspace'

/** The event the Rust shell emits; kept as a constant so both halves agree. */
export const FOLDER_CHANGED_EVENT = 'rbuilder://folder-changed'

/** Broadcast after an external change was applied, so the git panel re-reads. */
export const FOLDER_SYNCED_EVENT = 'rbuilder:folder-synced'

export type ExternalSyncPlan =
  | { kind: 'noop' }
  | { kind: 'skip'; reason: 'busy' | 'no-folder' | 'empty' }
  | {
      kind: 'apply'
      /** Files whose content differs from what the app holds. */
      changed: ProjectFile[]
      /** Paths that are gone from disk; null when the folder read was not trusted. */
      removed: string[]
    }

/**
 * Decides what an external folder read should do.
 *
 * `busy` covers an in-flight agent turn. `removed` is deliberately null while
 * busy or when the read came back empty: an empty read means the walk failed
 * or the folder was momentarily unreadable, and treating that as "the user
 * deleted everything" would delete their project.
 */
export function planExternalSync(input: {
  current: ProjectFile[]
  incoming: ImportedFile[]
  folder: string | null
  busy: boolean
}): ExternalSyncPlan {
  const { current, incoming, folder, busy } = input
  if (!folder) return { kind: 'skip', reason: 'no-folder' }
  if (busy) return { kind: 'skip', reason: 'busy' }

  const usable = incoming.filter((file) => file.path && !shouldIgnoreWorkspacePath(file.path))
  if (usable.length === 0) return { kind: 'skip', reason: 'empty' }

  const currentByPath = new Map(current.map((file) => [file.path, file.content]))
  const seen = new Set<string>()
  const changed: ProjectFile[] = []

  for (const file of usable) {
    seen.add(file.path)
    const known = currentByPath.get(file.path)
    // Identical content is not a change, and re-applying it would move the
    // diff baseline for no reason.
    if (known === file.content) continue
    changed.push({ path: file.path, content: file.content })
  }

  const removed = current
    .filter((file) => !seen.has(file.path))
    .map((file) => file.path)

  if (changed.length === 0 && removed.length === 0) return { kind: 'noop' }
  return { kind: 'apply', changed, removed }
}

type TauriEventBridge = {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> }
  event?: {
    listen?: (
      event: string,
      handler: (payload: unknown) => void,
    ) => Promise<() => void>
  }
}

function bridge(): TauriEventBridge | null {
  return (window as unknown as { __TAURI__?: TauriEventBridge }).__TAURI__ ?? null
}

/** Fires a window event so the git panel and the code workbench catch up. */
export function notifyFolderSynced(root: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FOLDER_SYNCED_EVENT, { detail: { root } }))
}

/**
 * Starts watching `root`. Returns a disposer that stops the shell watcher and
 * drops the event subscription.
 *
 * Returns null when the app is not running in the desktop shell: the browser
 * build has no folder to poll, so there is nothing to clean up.
 */
export async function watchProjectFolder(root: string): Promise<(() => void) | null> {
  if (!isDesktop()) return null
  const api = bridge()
  const run = api?.core?.invoke
  const listen = api?.event?.listen
  if (!run) return null

  let disposed = false
  let unlisten: (() => void) | null = null

  if (listen) {
    // The payload is ignored on purpose: the handler re-reads the folder, so
    // there is one answer to "what is on disk" instead of two that can differ.
    unlisten = await listen(FOLDER_CHANGED_EVENT, () => {
      if (disposed) return
      window.dispatchEvent(new CustomEvent(FOLDER_CHANGED_EVENT, { detail: { root } }))
    }).catch(() => null)
  }

  try {
    await run('watch_project_folder', { root })
  } catch (error) {
    console.warn('Не удалось включить наблюдение за папкой проекта:', error)
    unlisten?.()
    return null
  }

  return () => {
    disposed = true
    unlisten?.()
    void run('unwatch_project_folder').catch(() => undefined)
  }
}