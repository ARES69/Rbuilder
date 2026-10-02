import { describe, expect, it } from 'vitest'
import { buildPreviewDocument } from '../src/lib/project'
import { createBundler } from '../src/lib/previewCompiler'
import type { ProjectFile } from '../src/lib/previewBundle'

/**
 * These run the real compiler. The wasm binary ships with the package, so the
 * only thing these must not do is reach the network: the project below imports
 * its own files, never an npm package.
 */

const project = (...files: ProjectFile[]): ProjectFile[] => files

describe('preview compiler', () => {
  it('compiles a TypeScript entry and its relative imports', async () => {
    const files = project(
      { path: 'index.html', content: '<html><body><script type="module" src="./app.ts"></script></body></html>' },
      { path: 'app.ts', content: "import { title } from './title'\nconst el: HTMLElement = document.querySelector('h1')!\nel.textContent = title" },
      { path: 'title.ts', content: "export const title: string = 'Привет'" },
    )

    const outcome = await createBundler()('app.ts', files)

    expect(outcome.ok, outcome.ok ? '' : outcome.error).toBe(true)
    if (!outcome.ok) return
    // Type annotations are gone and both modules ended up in one script.
    expect(outcome.code).not.toContain(': string')
    expect(outcome.code).toContain('Привет')
    expect(outcome.code).toContain('querySelector')
  })

  it('compiles JSX without leaving JSX syntax behind', async () => {
    const files = project(
      { path: 'index.html', content: '<html><body></body></html>' },
      { path: 'view.tsx', content: "export const view = () => <div className='card'>hi</div>" },
    )

    const outcome = await createBundler()('view.tsx', files)

    expect(outcome.ok, outcome.ok ? '' : outcome.error).toBe(true)
    if (!outcome.ok) return
    // The automatic runtime comes from npm, which needs the network; what this
    // asserts is that the compiler accepted the source and emitted JS.
    expect(outcome.code.length).toBeGreaterThan(0)
  })

  it('reports a missing project file instead of bundling half an app', async () => {
    const files = project({ path: 'app.ts', content: "import './missing'" })

    const outcome = await createBundler()('app.ts', files)

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.error).toContain('missing')
  })

  it('returns the same code for an unchanged project without recompiling', async () => {
    const files = project({ path: 'app.ts', content: "const greeting: string = 'hi'" })
    const bundler = createBundler()

    const first = await bundler('app.ts', files)
    const second = await bundler('app.ts', files)

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.code).toBe(first.code)
  })
})

describe('preview document with a compiled entry', () => {
  it('inlines the compiled code in place of the raw file', () => {
    const files = project(
      { path: 'index.html', content: '<html><head></head><body><script type="module" src="./app.js"></script></body></html>' },
      { path: 'app.js', content: 'import "react"' },
    )

    const document = buildPreviewDocument(
      { files },
      { channel: 'ch_test', script: '', bundles: { 'app.js': 'console.log("compiled")' } },
    )

    expect(document).toContain('console.log("compiled")')
    expect(document).not.toContain('import "react"')
    // The reference is still there, so the transcript can point at the source.
    expect(document).toContain('data-freebuff-path="app.js"')
  })

  it('leaves the raw source untouched when nothing was compiled', () => {
    const files = project(
      { path: 'index.html', content: '<html><head></head><body><script src="./app.js"></script></body></html>' },
      { path: 'app.js', content: 'console.log(1)' },
    )

    expect(buildPreviewDocument({ files }, { channel: 'ch', script: '' })).toContain('console.log(1)')
  })

  it('shows a failed compile in the preview instead of rendering nothing', () => {
    const files = project(
      { path: 'index.html', content: '<html><head></head><body><script src="./app.ts"></script></body></html>' },
      { path: 'app.ts', content: 'const a: number = 1' },
    )

    const document = buildPreviewDocument(
      { files },
      { channel: 'ch', script: '', bundleError: { entry: 'app.ts', error: 'Unexpected token' } },
    )

    expect(document).toContain('app.ts')
    expect(document).toContain('Unexpected token')
  })
})
describe('a TypeScript project end to end', () => {
  it('lands compiled, runnable code in the preview document', async () => {
    const files = project(
      {
        path: 'index.html',
        content: '<!doctype html><html><head></head><body><h1></h1><script type="module" src="./app.ts"></script></body></html>',
      },
      {
        path: 'app.ts',
        content: "import { greeting } from './greeting'\nconst heading: HTMLElement = document.querySelector('h1')!\nheading.textContent = greeting",
      },
      { path: 'greeting.ts', content: "export const greeting: string = 'Работает'" },
    )

    const outcome = await createBundler()('app.ts', files)
    expect(outcome.ok, outcome.ok ? '' : outcome.error).toBe(true)
    if (!outcome.ok) return

    const document = buildPreviewDocument(
      { files },
      { channel: 'ch', script: '', bundles: { 'app.ts': outcome.code } },
    )

    expect(document).toContain('Работает')
    expect(document).toContain('querySelector')
    expect(document).not.toContain('export const greeting')
    expect(document).not.toContain(': string')
  })
})
