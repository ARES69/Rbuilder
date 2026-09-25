/**
 * Where the local server lives.
 *
 * In the browser and under `pnpm dev` the API is served from the same origin, so
 * every request stays relative. The desktop build serves the front end from a
 * custom scheme and runs the API as a separate local process, so the Tauri shell
 * injects `window.__RBUILDER_API_BASE__` (for example `http://127.0.0.1:5185`)
 * before the app boots. Everything that talks to the API goes through here, so
 * there is exactly one place where that difference exists.
 */

declare global {
  interface Window {
    __RBUILDER_API_BASE__?: string
    __TAURI__?: unknown
  }
}

/** Empty string in the browser: requests stay on the current origin. */
export function apiBase(): string {
  if (typeof window === 'undefined') return ''
  const injected = window.__RBUILDER_API_BASE__
  return typeof injected === 'string' ? injected.replace(/\/+$/, '') : ''
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${apiBase()}${normalized}`
}

/** True inside the desktop shell (Tauri injects its API on the window). */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI__)
}

/**
 * Address the app is actually served from, for the status lines in the sidebar.
 * In the desktop build that is the local server the shell started.
 */
export function serverLabel(): string {
  const base = apiBase()
  if (base) return base
  if (typeof window === 'undefined') return 'localhost'
  return window.location.origin
}
