// ---------------------------------------------------------------------------
// Theme state management
// ---------------------------------------------------------------------------

/**
 * localStorage key for persisted theme preference.
 */
export const STORAGE_KEY = 'ss-dash-theme'

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
 * Persist a theme preference to `localStorage`.
 *
 * Other tabs will be notified via the `storage` event, which
 * listeners created by {@link onThemeChange} will pick up.
 */
export function setTheme(theme: Theme): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, theme)
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
 * Subscribe to theme changes from other tabs (`storage` event)
 * and from system preference changes (`prefers-color-scheme`).
 *
 * @param callback - Invoked with the new theme value whenever it changes.
 * @returns An unsubscribe function that removes all listeners.
 */
export function onThemeChange(callback: (theme: Theme) => void): () => void {
  if (typeof window === 'undefined') return () => {}

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

  window.addEventListener('storage', handleStorage)
  mediaQuery.addEventListener('change', handleMedia)

  return () => {
    window.removeEventListener('storage', handleStorage)
    mediaQuery.removeEventListener('change', handleMedia)
  }
}
