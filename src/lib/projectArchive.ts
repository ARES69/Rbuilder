/**
 * A project leaves the app as one file. The archive is deliberately plain:
 * a name, a version and the file list, so it can be read, diffed and moved
 * between machines without the app. Importing runs the same path checks as the
 * model does when it writes a file, because an archive is untrusted input.
 */

import { MAX_FILES, MAX_FILE_BYTES, normalizePath, type ProjectFileInput } from './project'
import { createWorkspace, type Workspace } from './workspace'

export const ARCHIVE_FORMAT = 'rbuilder-project'
export const ARCHIVE_VERSION = 1

export type ProjectArchive = {
  format: typeof ARCHIVE_FORMAT
  version: number
  name: string
  exportedAt: number
  files: ProjectFileInput[]
}

export type ArchiveParse =
  | { ok: true; archive: ProjectArchive; skipped: string[] }
  | { ok: false; error: string }

export function createArchive(workspace: Workspace, exportedAt = Date.now()): ProjectArchive {
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    name: workspace.metadata.name,
    exportedAt,
    files: workspace.project.files.map((file) => ({ path: file.path, content: file.content })),
  }
}

/** Pretty-printed, because a person may well open it. */
export function archiveToText(archive: ProjectArchive): string {
  return `${JSON.stringify(archive, null, 2)}\n`
}

/** A file name that is safe on every platform: the task name, slugs and dashes. */
export function archiveFileName(name: string, exportedAt = Date.now()): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  const date = new Date(exportedAt).toISOString().slice(0, 10)
  return `${slug}-${date}.rbuilder.json`
}

/**
 * Reads an archive. Unknown or unusable entries are dropped rather than
 * failing the whole import: half a project is better than none.
 */
export function parseArchive(text: string): ArchiveParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'The archive is not an object.' }
  }

  const candidate = parsed as Partial<ProjectArchive>
  if (candidate.format !== ARCHIVE_FORMAT) {
    return { ok: false, error: 'This is not an RBuilder project archive.' }
  }
  if (typeof candidate.version !== 'number' || candidate.version > ARCHIVE_VERSION) {
    return { ok: false, error: `Archive version ${String(candidate.version)} is newer than this app understands.` }
  }
  if (!Array.isArray(candidate.files) || candidate.files.length === 0) {
    return { ok: false, error: 'The archive has no files.' }
  }

  const files: ProjectFileInput[] = []
  const skipped: string[] = []

  for (const entry of candidate.files.slice(0, MAX_FILES)) {
    if (typeof entry !== 'object' || entry === null) {
      skipped.push(String((entry as { path?: unknown })?.path ?? '?'))
      continue
    }
    const { path: rawPath, content: rawContent } = entry as { path?: unknown; content?: unknown }
    const path = typeof rawPath === 'string' ? normalizePath(rawPath) : null
    if (!path || typeof rawContent !== 'string') {
      skipped.push(typeof rawPath === 'string' ? rawPath : '?')
      continue
    }
    files.push({ path, content: rawContent.slice(0, MAX_FILE_BYTES) })
  }

  if (files.length === 0) return { ok: false, error: 'The archive has no usable files.' }

  return {
    ok: true,
    skipped,
    archive: {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : 'Импортированный проект',
      exportedAt: typeof candidate.exportedAt === 'number' ? candidate.exportedAt : Date.now(),
      files,
    },
  }
}

/** An imported archive becomes a new task; the baseline equals what was imported. */
export function workspaceFromArchive(archive: ProjectArchive): Workspace {
  const files = archive.files.map((file) => ({ ...file }))
  return createWorkspace({ files }, archive.name)
}

/** Reads a picked file as text. Browsers and the desktop shell share one path. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsText(file)
  })
}