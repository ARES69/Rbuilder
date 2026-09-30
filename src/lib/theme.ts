/**
 * Dark / light theme.
 *
 * The palette lives in `global.css` as CSS variables; `data-theme` on the root
 * element picks the set. Dark is the default — the app is a night-time IDE —
 * and the choice survives reloads.
 */

export type Theme = 'dark' | 'light'

const KEY = 'freebuff-web:theme'

export function loadTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* keep the choice in memory only */
  }
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}
