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
 * Picks just the folder (no read-back): the bound directory a new project's
 * files are written into. Returns null when the user cancels.
 */
export async function pickProjectFolderPath(): Promise<string | null> {
  return invoke<string | null>('pick_project_folder')
}

/** Mirrors the files the model wrote into the bound project folder. */
export async function writeProjectFiles(
  root: string,
  files: { path: string; content: string }[],
): Promise<number> {
  return invoke<number>('write_project_files', { root, files })
}

/** Removes one mirrored file; missing files count as removed. */
export async function deleteProjectFile(root: string, path: string): Promise<boolean> {
  return invoke<boolean>('delete_project_file', { root, path })
}

/* ------------------------------------------------------------------ */
/* Browser fallback: File System Access handles                        */
/* ------------------------------------------------------------------ */

/** The slice of a directory handle the mirror needs. */
export type DirectoryHandle = {
  name: string
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryHandle>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<WritableFileHandle>
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>
}

export type WritableFileHandle = {
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>
    close: () => Promise<void>
  }>
}

async function directoryFor(root: DirectoryHandle, segments: string[]): Promise<DirectoryHandle> {
  let handle = root
  for (const segment of segments) handle = await handle.getDirectoryHandle(segment, { create: true })
  return handle
}

/** Writes files through a File System Access handle (the browser build). */
export async function writeViaDirectoryHandle(
  root: DirectoryHandle,
  files: { path: string; content: string }[],
): Promise<void> {
  for (const file of files) {
    const segments = file.path.split('/')
    const name = segments.pop()
    if (!name) continue
    const dir = await directoryFor(root, segments)
    const fileHandle = await dir.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(file.content)
    await writable.close()
  }
}

/** Removes one file through a File System Access handle; missing is fine. */
export async function deleteViaDirectoryHandle(root: DirectoryHandle, path: string): Promise<void> {
  const segments = path.split('/')
  const name = segments.pop()
  if (!name) return
  const dir = await directoryFor(root, segments)
  await dir.removeEntry(name)
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
