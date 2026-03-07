// ---------------------------------------------------------------------------
// Shared bootstrap utilities for Edge entry points (Preact & Vue)
// ---------------------------------------------------------------------------

import { getTheme, onThemeChange } from '../core/theme.js'

/**
 * Read a JSON config object from a `<script>` tag embedded in the page.
 *
 * Edge templates serialise config into a hidden `<script type="application/json">`
 * element. This helper locates it by `id`, parses the JSON, and returns a typed
 * config object.
 */
export function readConfig<T>(elementId: string): T {
  const el = document.getElementById(elementId)
  return el ? JSON.parse(el.textContent || '{}') : ({} as T)
}

/**
 * Synchronise the persisted theme preference to the `<html>` element.
 *
 * Sets `data-theme` on `document.documentElement` immediately and subscribes
 * to future changes so that dashboard CSS `:root` / `[data-theme]` selectors
 * stay in sync.
 */
export function setupThemeSync(): void {
  function syncTheme(theme: string) {
    document.documentElement.setAttribute('data-theme', theme)
  }
  syncTheme(getTheme())
  onThemeChange(syncTheme)
}
