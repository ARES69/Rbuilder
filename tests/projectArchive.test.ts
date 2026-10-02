import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_FORMAT,
  archiveFileName,
  archiveToText,
  createArchive,
  parseArchive,
  workspaceFromArchive,
} from '../src/lib/projectArchive'
import { createWorkspace } from '../src/lib/workspace'

const workspace = () =>
  createWorkspace(
    {
      files: [
        { path: 'index.html', content: '<h1>hi</h1>' },
        { path: 'app.js', content: 'console.log(1)' },
      ],
    },
    'Таймер',
  )

describe('project archive', () => {
  it('carries the task name and every file', () => {
    const archive = createArchive(workspace(), 1_700_000_000_000)

    expect(archive.format).toBe(ARCHIVE_FORMAT)
    expect(archive.name).toBe('Таймер')
    expect(archive.exportedAt).toBe(1_700_000_000_000)
    expect(archive.files).toEqual([
      { path: 'index.html', content: '<h1>hi</h1>' },
      { path: 'app.js', content: 'console.log(1)' },
    ])
  })

  it('survives a round trip through the file', () => {
    const original = createArchive(workspace(), 1_700_000_000_000)
    const parsed = parseArchive(archiveToText(original))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.archive).toEqual(original)
    expect(parsed.skipped).toEqual([])
  })

  it('reads an archive by hand, as a person would write it', () => {
    const parsed = parseArchive(
      JSON.stringify({
        format: ARCHIVE_FORMAT,
        version: 1,
        name: 'Ручной',
        files: [{ path: 'index.html', content: '<p>ok</p>' }],
      }),
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.archive.name).toBe('Ручной')
    expect(parsed.archive.files).toHaveLength(1)
  })
})

describe('parseArchive rejects', () => {
  it('text that is not JSON', () => {
    const parsed = parseArchive('не json')
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error).toContain('JSON')
  })

  it('a file from another app', () => {
    const parsed = parseArchive(JSON.stringify({ format: 'something-else', version: 1, files: [{ path: 'a', content: 'b' }] }))
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error).toContain('not an RBuilder')
  })

  it('a version from the future', () => {
    const parsed = parseArchive(JSON.stringify({ format: ARCHIVE_FORMAT, version: 99, files: [{ path: 'a', content: 'b' }] }))
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error).toContain('newer')
  })

  it('an archive without files', () => {
    const parsed = parseArchive(JSON.stringify({ format: ARCHIVE_FORMAT, version: 1, files: [] }))
    expect(parsed.ok).toBe(false)
  })

  it('an archive where every entry is unusable', () => {
    const parsed = parseArchive(
      JSON.stringify({ format: ARCHIVE_FORMAT, version: 1, files: [{ path: '../escape.js', content: 'x' }] }),
    )
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error).toContain('no usable files')
  })
})

describe('parseArchive sanitises', () => {
  it('drops entries that escape the project and keeps the rest', () => {
    const parsed = parseArchive(
      JSON.stringify({
        format: ARCHIVE_FORMAT,
        version: 1,
        files: [
          { path: '../escape.js', content: 'x' },
          { path: 'C:/evil.js', content: 'x' },
          { path: 'ok.js', content: 'y' },
          { path: 'broken.js' },
        ],
      }),
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.archive.files.map((file) => file.path)).toEqual(['ok.js'])
    expect(parsed.skipped).toEqual(['../escape.js', 'C:/evil.js', 'broken.js'])
  })

  it('truncates a file that is over the size limit', () => {
    const parsed = parseArchive(
      JSON.stringify({
        format: ARCHIVE_FORMAT,
        version: 1,
        files: [{ path: 'big.js', content: 'x'.repeat(600_000) }],
      }),
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.archive.files[0]!.content.length).toBeLessThanOrEqual(512 * 1024)
  })

  it('names the project when the archive forgot', () => {
    const parsed = parseArchive(JSON.stringify({ format: ARCHIVE_FORMAT, version: 1, files: [{ path: 'a.js', content: '' }] }))

    expect(parsed.ok && parsed.archive.name.length).toBeGreaterThan(0)
  })
})

describe('archiveFileName', () => {
  it('makes a safe name out of the task name', () => {
    const name = archiveFileName('Таймер / Pomodoro 2.0', 1_700_000_000_000)

    expect(name).toBe('таймер-pomodoro-2-0-2023-11-14.rbuilder.json')
    // Nothing that a file system would object to.
    expect(name).not.toMatch(/[\\/:*?"<>|\s]/)
  })

  it('falls back when the name has nothing usable', () => {
    expect(archiveFileName('***', 1_700_000_000_000)).toMatch(/^project-\d{4}-\d{2}-\d{2}\.rbuilder\.json$/)
  })
})

describe('workspaceFromArchive', () => {
  it('creates a task whose baseline is what was imported', () => {
    const imported = workspaceFromArchive(createArchive(workspace(), 1_700_000_000_000))

    expect(imported.metadata.name).toBe('Таймер')
    expect(imported.project.files).toHaveLength(2)
    expect(imported.baseline).toEqual(imported.project)
    // A new id, so importing twice never overwrites the original task.
    expect(imported.metadata.id).not.toBe(workspace().metadata.id)
  })
})