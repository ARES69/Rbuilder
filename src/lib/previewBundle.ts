/**
 * The preview renders plain HTML, CSS and JavaScript. A real app wants npm
 * packages and JSX, and neither survives a sandboxed iframe: a bare import like
 * `react` has nothing to resolve to, and `.tsx` is not a language the browser
 * knows. esbuild compiles the entry into one classic script instead:
 *
 *   - the project's own files are served from memory,
 *   - npm packages are fetched from a CDN that ships them pre-bundled,
 *   - the result is inlined into the preview document like any other script.
 *
 * One classic script rather than a module graph on purpose: the preview runs
 * in an opaque-origin iframe, where a module importing data:/blob: URLs or a
 * CDN origin would need the host application's Content-Security-Policy opened
 * up. Compiling here keeps the sandbox exactly as narrow as it is today.
 *
 * Plain JavaScript projects never come here: `planBundle` returns no entries
 * and the preview is built exactly as it was before.
 */

import type { ProjectFile } from './project'

export type { ProjectFile }

/** Where npm packages are fetched from; kept here so the URL and its origin agree. */
const CDN_ORIGIN = 'https://esm.sh'

/** Extensions the compiler has to transform before a browser can run them. */
const COMPILED = /\.(tsx?|jsx|mjs|cjs)$/i
/** Specifiers that name a package rather than a file in the project. */
const bareSpecifier = /^[^./][^:]*$/

/** What the preview compiler has to produce for one entry file. */
export type BundleRequest = {
  entry: string
  files: ProjectFile[]
}

export type BundleCompiler = (request: BundleRequest) => Promise<string>

export type BundleOutcome =
  | { ok: true; code: string; entry: string; cached: boolean }
  | { ok: false; entry: string; error: string }

export type BundlePlan = {
  /** Entry files that need compiling; empty means the old path is enough. */
  entries: string[]
  /** Why compilation is needed, for the interface. */
  reason: string | null
}

/** A package specifier mapped to a pre-bundled CDN file. */
export function npmCdnUrl(specifier: string): string | null {
  if (!bareSpecifier.test(specifier)) return null
  if (/^(https?:)?\/\//i.test(specifier)) return null

  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
  const subpath = specifier.startsWith('@') ? parts.slice(2).join('/') : parts.slice(1).join('/')

  return `${CDN_ORIGIN}/${name}${subpath ? `/${subpath}` : ''}?bundle&target=es2022`
}

/** Bare specifiers a source file imports, without duplicates. */
export function bareSpecifiers(source: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? ''
      if (npmCdnUrl(specifier)) found.add(specifier)
    }
  }

  return [...found]
}

/** True when the file itself needs a compiler pass. */
export function needsCompiling(path: string, source: string): boolean {
  return COMPILED.test(path) || bareSpecifiers(source).length > 0
}

/**
 * The scripts index.html points at, in document order, resolved to project
 * files. External and inline scripts are skipped.
 */
export function scriptEntries(files: ProjectFile[]): ProjectFile[] {
  const index = files.find((file) => file.path.toLowerCase() === 'index.html')
  if (!index) return []

  const entries: ProjectFile[] = []
  const tags = index.content.match(/<script\b[^>]*>/gi) ?? []

  for (const tag of tags) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!src) continue
    const cleaned = src.trim().split('#')[0]!.split('?')[0]!.replace(/^\.\//, '')
    if (/^(https?:)?\/\//i.test(cleaned) || cleaned.startsWith('data:')) continue
    const file = files.find((entry) => entry.path === cleaned || entry.path.toLowerCase() === cleaned.toLowerCase())
    if (file) entries.push(file)
  }

  return entries
}

/**
 * Decides what, if anything, has to be compiled. Nothing is compiled unless a
 * script the page actually loads asks for it: a project of plain scripts keeps
 * the fast path and never waits for the compiler.
 */
export function planBundle(files: ProjectFile[]): BundlePlan {
  const entries: string[] = []
  const reasons: string[] = []

  for (const file of scriptEntries(files)) {
    const bare = bareSpecifiers(file.content)
    if (COMPILED.test(file.path)) reasons.push(`${file.path} is TypeScript or JSX`)
    if (bare.length > 0) reasons.push(`${file.path} imports ${bare.slice(0, 3).join(', ')}`)
    if (needsCompiling(file.path, file.content) && !entries.includes(file.path)) entries.push(file.path)
  }

  return { entries, reason: reasons.length > 0 ? reasons.join('; ') : null }
}

/** Joins a relative import against the file that made it, inside the project. */
export function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null

  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const segments = `${base ? `${base}/` : ''}${specifier}`.split('/')
  const stack: string[] = []

  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') stack.pop()
    else stack.push(segment)
  }

  return stack.join('/') || null
}

const CANDIDATE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json', '/index.tsx', '/index.ts', '/index.js']

/**
 * Finds the file a relative import names. TypeScript projects import without an
 * extension (`./title`), so the usual suffixes are tried the way a bundler does.
 */
export function resolveImportFile(from: string, specifier: string, files: ProjectFile[]): ProjectFile | null {
  const base = resolveImport(from, specifier)
  if (!base) return null

  for (const suffix of CANDIDATE_SUFFIXES) {
    const wanted = `${base}${suffix}`
    const exact = files.find((file) => file.path === wanted)
    if (exact) return exact
  }

  const lowered = base.toLowerCase()
  return files.find((file) => file.path.toLowerCase() === lowered) ?? null
}

/** esbuild loader for a project file, by extension. */
export function loaderFor(path: string): string {
  if (/\.tsx$/i.test(path)) return 'tsx'
  if (/\.jsx$/i.test(path)) return 'jsx'
  if (/\.ts$/i.test(path)) return 'ts'
  if (/\.json$/i.test(path)) return 'json'
  if (/\.css$/i.test(path)) return 'text'
  return 'js'
}

/** Stable signature of the inputs, so an unchanged project is never recompiled. */
export function bundleSignature(files: ProjectFile[], entry: string): string {
  let hash = 0x811c9dc5
  const step = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
  }

  for (const file of files) {
    step(file.path)
    step(file.content)
  }
  step(entry)

  return (hash >>> 0).toString(36)
}