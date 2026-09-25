import { describe, expect, it } from 'vitest'
import {
  buildPreviewDocument,
  createStarterProject,
  hasIndex,
  normalizePath,
  projectContext,
  upsertFiles,
  type Project,
} from '../src/lib/project'

describe('normalizePath', () => {
  it('strips leading ./ and slashes', () => {
    expect(normalizePath('./styles.css')).toBe('styles.css')
    expect(normalizePath('/index.html')).toBe('index.html')
    expect(normalizePath('assets\\logo.svg')).toBe('assets/logo.svg')
  })

  it('rejects traversal and absolute paths', () => {
    expect(normalizePath('../secrets.txt')).toBeNull()
    expect(normalizePath('a/../../b')).toBeNull()
    expect(normalizePath('C:/windows/system32')).toBeNull()
    expect(normalizePath('')).toBeNull()
  })

  it('drops query strings and fragments', () => {
    expect(normalizePath('styles.css?v=2')).toBe('styles.css')
    expect(normalizePath('app.js#main')).toBe('app.js')
  })
})

describe('upsertFiles', () => {
  it('replaces a file in place and keeps ordering stable', () => {
    const project = createStarterProject()
    const next = upsertFiles(project, [{ path: 'styles.css', content: 'body { color: red }' }])

    expect(next.files.map((file) => file.path)).toEqual(project.files.map((file) => file.path))
    expect(next.files[1]?.content).toBe('body { color: red }')
  })

  it('appends new files and ignores invalid paths', () => {
    const project = createStarterProject()
    const next = upsertFiles(project, [
      { path: 'app.js', content: 'console.log(1)' },
      { path: '../escape.js', content: 'nope' },
    ])

    expect(next.files.map((file) => file.path)).toEqual(['index.html', 'styles.css', 'app.js'])
  })

  it('returns the same project when nothing changed', () => {
    const project = createStarterProject()
    expect(upsertFiles(project, [{ path: 'index.html', content: project.files[0]!.content }])).toBe(
      project,
    )
  })
})

describe('buildPreviewDocument', () => {
  const project: Project = {
    files: [
      {
        path: 'index.html',
        content: [
          '<!doctype html>',
          '<html><head>',
          '<link rel="stylesheet" href="./styles.css">',
          '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
          '</head><body>',
          '<script src="app.js" defer></script>',
          '<script src="https://cdn.example.com/y.js"></script>',
          '</body></html>',
        ].join('\n'),
      },
      { path: 'styles.css', content: 'body { margin: 0 }' },
      { path: 'app.js', content: 'document.body.dataset.ready = "yes"' },
    ],
  }

  it('inlines project stylesheets and scripts', () => {
    const document = buildPreviewDocument(project)

    expect(document).toContain('<style data-freebuff-path="styles.css">')
    expect(document).toContain('body { margin: 0 }')
    expect(document).toContain('data-freebuff-path="app.js"')
    expect(document).toContain('document.body.dataset.ready')
    expect(document).not.toContain('href="./styles.css"')
    expect(document).not.toContain('src="app.js"')
  })

  it('leaves remote references alone', () => {
    const document = buildPreviewDocument(project)

    expect(document).toContain('https://cdn.example.com/x.css')
    expect(document).toContain('https://cdn.example.com/y.js')
  })

  it('escapes closing script tags inside inlined scripts', () => {
    const document = buildPreviewDocument({
      files: [
        { path: 'index.html', content: '<html><body><script src="tricky.js"></script></body></html>' },
        { path: 'tricky.js', content: 'const s = "</script>"' },
      ],
    })

    expect(document).toContain('<\\/script>')
    expect(document).not.toContain('""</script>"')
  })

  it('falls back to a placeholder when index.html is missing', () => {
    const document = buildPreviewDocument({ files: [{ path: 'notes.md', content: 'hi' }] })

    expect(document).toContain('Nothing to preview yet')
    expect(document).toContain('notes.md')
  })
})

describe('project helpers', () => {
  it('detects a missing index and describes the project for the model', () => {
    expect(hasIndex(createStarterProject())).toBe(true)
    expect(hasIndex({ files: [] })).toBe(false)
    expect(projectContext({ files: [] })).toBe('The project is currently empty.')
    expect(projectContext(createStarterProject())).toContain('index.html')
  })
})
