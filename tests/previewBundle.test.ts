import { describe, expect, it } from 'vitest'
import {
  bareSpecifiers,
  bundleSignature,
  loaderFor,
  needsCompiling,
  npmCdnUrl,
  planBundle,
  resolveImport,
  resolveImportFile,
  scriptEntries,
} from '../src/lib/previewBundle'

const files = (...entries: [string, string][]) => entries.map(([path, content]) => ({ path, content }))

const page = (script: string) => `<!doctype html><html><body><script ${script}></script></body></html>`

describe('planBundle', () => {
  it('leaves a plain JavaScript project alone', () => {
    const project = files(
      ['index.html', page('src="./app.js"')],
      ['app.js', 'console.log("hi")'],
    )

    expect(planBundle(project)).toEqual({ entries: [], reason: null })
  })

  it('compiles a TypeScript or JSX entry', () => {
    const project = files(
      ['index.html', page('type="module" src="./app.tsx"')],
      ['app.tsx', 'const a: number = 1'],
    )

    const plan = planBundle(project)
    expect(plan.entries).toEqual(['app.tsx'])
    expect(plan.reason).toContain('app.tsx is TypeScript or JSX')
  })

  it('compiles a plain script that imports a package', () => {
    const project = files(
      ['index.html', page('src="./app.js"')],
      ['app.js', 'import confetti from "canvas-confetti"\nconfetti()'],
    )

    const plan = planBundle(project)
    expect(plan.entries).toEqual(['app.js'])
    expect(plan.reason).toContain('canvas-confetti')
  })

  it('ignores a script the page never loads', () => {
    const project = files(
      ['index.html', '<html><body></body></html>'],
      ['helper.ts', 'export const x: number = 1'],
    )

    expect(planBundle(project).entries).toEqual([])
  })

  it('ignores external and inline scripts', () => {
    const project = files(
      ['index.html', page('src="https://cdn.example/x.ts"')],
      ['app.ts', 'const a: number = 1'],
    )

    expect(planBundle(project).entries).toEqual([])
  })

  it('lists every loaded script that needs compiling', () => {
    const project = files(
      ['index.html', `${page('src="./a.ts"')}`],
      ['a.ts', 'const a: number = 1'],
    )

    expect(scriptEntries(project).map((file) => file.path)).toEqual(['a.ts'])
  })
})

describe('bareSpecifiers', () => {
  it('finds static, dynamic and require-style package imports', () => {
    const source = [
      'import React from "react"',
      "import { render } from 'react-dom/client'",
      "import confetti from 'canvas-confetti'",
      "const lazy = await import('lodash-es')",
    ].join('\n')

    expect(bareSpecifiers(source)).toEqual(['react', 'react-dom/client', 'canvas-confetti', 'lodash-es'])
  })

  it('leaves relative and absolute imports out', () => {
    const source = ['import a from "./a.js"', "import b from '/x.js'", "import c from 'https://x/y.js'"].join('\n')

    expect(bareSpecifiers(source)).toEqual([])
  })

  it('does not repeat a package imported twice', () => {
    expect(bareSpecifiers('import "react"\nimport "react"')).toEqual(['react'])
  })

  it('decides per file whether a compiler pass is needed', () => {
    expect(needsCompiling('app.js', 'console.log(1)')).toBe(false)
    expect(needsCompiling('app.ts', 'const a = 1')).toBe(true)
    expect(needsCompiling('app.js', 'import "react"')).toBe(true)
  })
})

describe('npmCdnUrl', () => {
  it('points a package at a pre-bundled CDN file', () => {
    expect(npmCdnUrl('react')).toBe('https://esm.sh/react?bundle&target=es2022')
  })

  it('keeps the subpath of a package', () => {
    expect(npmCdnUrl('react-dom/client')).toBe('https://esm.sh/react-dom/client?bundle&target=es2022')
  })

  it('handles scoped packages and pinned versions', () => {
    expect(npmCdnUrl('@scope/pkg')).toBe('https://esm.sh/@scope/pkg?bundle&target=es2022')
    expect(npmCdnUrl('@scope/pkg/sub')).toBe('https://esm.sh/@scope/pkg/sub?bundle&target=es2022')
    expect(npmCdnUrl('react@18.3.1')).toBe('https://esm.sh/react@18.3.1?bundle&target=es2022')
  })

  it('refuses anything that is not a package', () => {
    expect(npmCdnUrl('./local.js')).toBeNull()
    expect(npmCdnUrl('../up.js')).toBeNull()
    expect(npmCdnUrl('https://cdn.example/x.js')).toBeNull()
  })
})

describe('resolveImport', () => {
  it('resolves a sibling import', () => {
    expect(resolveImport('app.js', './util.js')).toBe('util.js')
  })

  it('resolves into a subfolder and back out of one', () => {
    expect(resolveImport('src/app.js', './util/helper.js')).toBe('src/util/helper.js')
    expect(resolveImport('src/views/app.js', '../../lib/x.js')).toBe('lib/x.js')
  })

  it('refuses a package specifier', () => {
    expect(resolveImport('app.js', 'react')).toBeNull()
  })
})

describe('resolveImportFile', () => {
  const project = files(
    ['title.ts', 'export const title = 1'],
    ['src/util/helper.tsx', 'export const helper = 1'],
    ['src/data.json', '{}'],
    ['src/index.js', 'export default 1'],
  )

  it('resolves an extensionless import the way TypeScript does', () => {
    expect(resolveImportFile('app.ts', './title', project)?.path).toBe('title.ts')
  })

  it('resolves into subfolders and finds index files', () => {
    expect(resolveImportFile('app.ts', './src/util/helper', project)?.path).toBe('src/util/helper.tsx')
    expect(resolveImportFile('app.ts', './src', project)?.path).toBe('src/index.js')
  })

  it('resolves an explicit extension and JSON', () => {
    expect(resolveImportFile('app.ts', './title.ts', project)?.path).toBe('title.ts')
    expect(resolveImportFile('app.ts', './src/data.json', project)?.path).toBe('src/data.json')
  })

  it('returns null for a package and for a file that is not there', () => {
    expect(resolveImportFile('app.ts', 'react', project)).toBeNull()
    expect(resolveImportFile('app.ts', './nowhere', project)).toBeNull()
  })
})

describe('loaderFor', () => {
  it('maps extensions to esbuild loaders', () => {
    expect(loaderFor('app.tsx')).toBe('tsx')
    expect(loaderFor('app.ts')).toBe('ts')
    expect(loaderFor('app.jsx')).toBe('jsx')
    expect(loaderFor('data.json')).toBe('json')
    expect(loaderFor('app.js')).toBe('js')
  })
})

describe('bundleSignature', () => {
  it('changes when a file changes and when the entry changes', () => {
    const project = files(['app.ts', 'const a = 1'])
    const edited = files(['app.ts', 'const a = 2'])

    expect(bundleSignature(project, 'app.ts')).toBe(bundleSignature(project, 'app.ts'))
    expect(bundleSignature(project, 'app.ts')).not.toBe(bundleSignature(edited, 'app.ts'))
    expect(bundleSignature(project, 'app.ts')).not.toBe(bundleSignature(project, 'other.ts'))
  })
})