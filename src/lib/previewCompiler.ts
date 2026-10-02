/**
 * Drives esbuild for the preview: the wasm binary ships with the app, so the
 * compiler works offline and only costs what a single `.wasm` fetch costs the
 * first time. npm packages are the only thing that needs the network, and only
 * when a project actually imports one.
 *
 * Results are cached by the project's contents, so re-rendering an unchanged
 * preview never recompiles it.
 */

import wasmUrl from 'esbuild-wasm/esbuild.wasm?url'
import {
  bundleSignature,
  loaderFor,
  npmCdnUrl,
  resolveImportFile,
  type BundleOutcome,
  type BundleRequest,
  type ProjectFile,
} from './previewBundle'

/** Paths handed to esbuild are rooted here and mapped back to project paths. */
const VIRTUAL_ROOT = '/rbuilder'

/** Namespace the project's own files live in inside the compiler. */
const PROJECT_NAMESPACE = 'rbuilder-project'

/** Where npm packages come from; the origin is what their URLs hang off. */
const CDN_ORIGIN = 'https://esm.sh'

type EsbuildBuildResult = { outputFiles: { text: string }[] }
type EsbuildApi = {
  initialize: (options?: { wasmURL?: string; worker?: boolean }) => Promise<unknown>
  build: (options: Record<string, unknown>) => Promise<EsbuildBuildResult>
}

let engine: Promise<EsbuildApi> | null = null

/** Loads and initialises the compiler once per page. */
async function esbuild(): Promise<EsbuildApi> {
  if (!engine) {
    engine = import('esbuild-wasm').then(async (loaded) => {
      const api = ((loaded as { default?: EsbuildApi }).default ?? loaded) as EsbuildApi
      // The browser build fetches the wasm from the app's own assets; the Node
      // build (tests, SSR) finds it next to the package and rejects wasmURL.
      const browser = typeof window !== 'undefined'
      await api.initialize(browser ? { wasmURL: wasmUrl, worker: false } : {})
      return api
    })
  }
  return engine
}

function toProjectPath(path: string): string {
  const at = path.indexOf(`${VIRTUAL_ROOT}/`)
  if (at >= 0) return path.slice(at + VIRTUAL_ROOT.length + 1)
  return path.replace(/^\//, '')
}

/** The two plugin hooks esbuild exposes, kept loose on purpose. */
type PluginBuild = {
  onResolve: (options: unknown, callback: (args: Record<string, string>) => unknown) => void
  onLoad: (options: unknown, callback: (args: Record<string, string>) => unknown) => void
}

/** Serves the project's own files to esbuild from memory. */
function projectFilesPlugin(files: ProjectFile[]) {
  return {
    name: 'rbuilder-project',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^\.{1,2}\// }, (args: Record<string, string>) => {
        const file = resolveImportFile(toProjectPath(args.importer ?? ''), args.path, files)

        if (!file) {
          return {
            errors: [
              {
                text: `Cannot find "${args.path}" imported from ${toProjectPath(args.importer ?? '')}. Add the file to the project.`,
              },
            ],
          }
        }

        // Its own namespace, so a project path never has to look like a real
        // file path on the machine running the compiler.
        return { path: file.path, namespace: PROJECT_NAMESPACE }
      })

      build.onLoad({ filter: /.*/, namespace: PROJECT_NAMESPACE }, (args: Record<string, string>) => {
        const file = files.find((entry) => entry.path === args.path)
        if (!file) return null
        return { contents: file.content, loader: loaderFor(file.path) }
      })
    },
  }
}

/**
 * Resolves package specifiers through a CDN that serves them pre-bundled, so
 * one request per package instead of one per file inside it.
 */
function npmCdnPlugin() {
  return {
    name: 'rbuilder-npm',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: Record<string, string>) => {
        // Inside a fetched package, its own relative and root-relative URLs
        // have to be followed, or a chunked build comes back as bare paths.
        if (args.namespace === 'rbuilder-cdn') {
          const url = args.path.startsWith('/')
            ? `${CDN_ORIGIN}${args.path}`
            : new URL(args.path, args.importer).href
          return { path: url, namespace: 'rbuilder-cdn' }
        }

        const url = npmCdnUrl(args.path)
        if (!url) return { external: true }
        return { path: url, namespace: 'rbuilder-cdn' }
      })

      build.onLoad(
        { filter: /.*/, namespace: 'rbuilder-cdn' },
        async (args: Record<string, string>) => {
          const response = await fetch(args.path)
          if (!response.ok) {
            throw new Error(`${args.path} could not be loaded (HTTP ${response.status}).`)
          }
          return { contents: await response.text(), loader: 'js' }
        },
      )
    },
  }
}

async function compile(request: BundleRequest): Promise<string> {
  const api = await esbuild()
  const entry = request.files.find((file) => file.path === request.entry)

  if (!entry) throw new Error(`The file ${request.entry} is not in the project.`)

  const result = await api.build({
    stdin: {
      contents: entry.content,
      resolveDir: `${VIRTUAL_ROOT}/`,
      sourcefile: request.entry,
      loader: loaderFor(request.entry),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    // React's automatic runtime is what the model writes by default.
    jsx: 'automatic',
    jsxImportSource: 'react',
    // Non-ASCII text stays readable instead of turning into \u escapes.
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    plugins: [projectFilesPlugin(request.files), npmCdnPlugin()],
  })

  const output = result.outputFiles?.[0]
  if (!output?.text) throw new Error('The compiler produced no output.')
  return output.text
}

/**
 * Compiles one entry, remembering the result until the project's contents
 * change. A failure is cached too: a broken import should not re-run the
 * compiler on every re-render of the preview.
 */
export function createBundler(): (entry: string, files: ProjectFile[]) => Promise<BundleOutcome> {
  const cache = new Map<string, BundleOutcome>()

  return async (entry, files) => {
    const key = bundleSignature(files, entry)
    const hit = cache.get(key)
    if (hit) return { ...hit, cached: true }

    let outcome: BundleOutcome
    try {
      outcome = { ok: true, code: await compile({ entry, files }), entry, cached: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcome = { ok: false, entry, error: message }
    }

    cache.set(key, outcome)
    return outcome
  }
}

let shared: ReturnType<typeof createBundler> | null = null

/** The bundler the application uses; tests build their own. */
export function previewBundler(): ReturnType<typeof createBundler> {
  if (!shared) shared = createBundler()
  return shared
}