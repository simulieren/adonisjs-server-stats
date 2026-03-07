// ---------------------------------------------------------------------------
// Theme state management
// ---------------------------------------------------------------------------

/**
 * localStorage key for persisted theme preference.
 */
export const STORAGE_KEY = 'ss-dash-theme'

/**
 * Custom DOM event name used to synchronize theme changes
 * across multiple component trees within the same tab.
 *
 * The native `storage` event only fires in *other* tabs, so
 * components rendered as separate React/Vue roots on the same
 * page (e.g. StatsBar and DebugPanel) would never learn about
 * each other's changes. This custom event fills that gap.
 */
const THEME_CHANGE_EVENT = 'ss-theme-change'

/**
 * The two supported theme values.
 */
export type Theme = 'dark' | 'light'

/**
 * Read the current theme preference.
 *
 * Resolution order:
 * 1. Explicit value stored in `localStorage` under {@link STORAGE_KEY}.
 * 2. System preference via `prefers-color-scheme` media query.
 * 3. Falls back to `'light'` if neither is available (e.g. SSR).
 */
export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'light'

  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored

  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/**
 * Persist a theme preference to `localStorage` and notify
 * all in-page listeners via a custom DOM event.
 *
 * Other tabs will be notified via the native `storage` event,
 * which listeners created by {@link onThemeChange} also handle.
 */
export function setTheme(theme: Theme): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, theme)

  // Dispatch a same-tab custom event so that all useTheme() /
  // useTheme composable instances re-render immediately.
  // The native `storage` event only fires in *other* tabs.
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }))
}

/**
 * Toggle the current theme and persist the new value.
 *
 * @returns The newly active theme.
 */
export function toggleTheme(): Theme {
  const current = getTheme()
  const next: Theme = current === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/**
 * Subscribe to theme changes from:
 * - Same-tab components (via custom {@link THEME_CHANGE_EVENT} event)
 * - Other tabs (via native `storage` event)
 * - System preference changes (via `prefers-color-scheme` media query)
 *
 * @param callback - Invoked with the new theme value whenever it changes.
 * @returns An unsubscribe function that removes all listeners.
 */
export function onThemeChange(callback: (theme: Theme) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  // Listen for same-tab theme changes via custom event.
  // This is the primary in-page synchronization mechanism
  // (mirrors the old vanilla JS `window.__ssApplyBarTheme()` pattern).
  const handleCustom = (event: Event) => {
    const theme = (event as CustomEvent<Theme>).detail
    if (theme === 'dark' || theme === 'light') {
      callback(theme)
    }
  }

  // Listen for cross-tab changes via localStorage
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      const value = event.newValue
      if (value === 'dark' || value === 'light') {
        callback(value)
      } else {
        // Key was removed — fall back to system preference
        callback(getTheme())
      }
    }
  }

  // Listen for system preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleMedia = (event: MediaQueryListEvent) => {
    // Only fire if there is no explicit override in localStorage
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      callback(event.matches ? 'dark' : 'light')
    }
  }

  window.addEventListener(THEME_CHANGE_EVENT, handleCustom)
  window.addEventListener('storage', handleStorage)
  mediaQuery.addEventListener('change', handleMedia)

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handleCustom)
    window.removeEventListener('storage', handleStorage)
    mediaQuery.removeEventListener('change', handleMedia)
  }
}
