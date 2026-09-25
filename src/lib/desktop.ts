/**
 * The desktop bridge.
 *
 * The browser build imports a folder with the File System Access API, which
 * WebView2 does not implement, and exports a file by downloading it, which the
 * desktop shell handles better with a real save dialog. Both differences live
 * here: one small wrapper over the Tauri commands, and honest fallbacks when the
 * app runs in a plain browser.
 */

import { isDesktop } from './apiBase'

export type ImportedFile = { path: string; content: string }
export type ImportedFolder = { name: string; files: ImportedFile[] }

type TauriBridge = {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> }
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = (window as unknown as { __TAURI__?: TauriBridge }).__TAURI__
  const run = bridge?.core?.invoke
  if (!run) throw new Error('The desktop bridge is not available in this build.')
  return run(command, args) as Promise<T>
}

export { isDesktop }

/**
 * Asks the shell for a folder and reads it in Rust. Returns null when the user
 * cancels. The file list is capped by the Rust side (count, per-file size and
 * skipped directories), so an accidental `node_modules` cannot flood the project.
 */
export async function pickProjectFolder(): Promise<ImportedFolder | null> {
  const path = await invoke<string | null>('pick_project_folder')
  if (!path) return null

  const payload = await invoke<{ name: string; files: ImportedFile[] }>('read_project_files', { path })
  return { name: payload.name, files: payload.files }
}

/**
 * Saves text through the shell's save dialog. In the browser this falls back to a
 * download, so the button works in both builds.
 */
export async function saveTextFile(suggestedName: string, content: string): Promise<{ saved: boolean; path?: string }> {
  if (isDesktop()) {
    const path = await invoke<string | null>('save_text_file', { suggestedName, content })
    return path ? { saved: true, path } : { saved: false }
  }

  const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = suggestedName
  anchor.click()
  URL.revokeObjectURL(url)
  return { saved: true, path: suggestedName }
}
