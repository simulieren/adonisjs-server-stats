/**
 * Vue composable for theme management.
 *
 * Wraps the core theme module with Vue reactivity.
 */

import { ref, onMounted, onUnmounted } from 'vue'
import {
  getTheme,
  toggleTheme as coreToggleTheme,
  onThemeChange,
} from '../../core/index.js'
import type { Theme } from '../../core/index.js'

export function useTheme() {
  const theme = ref<Theme>(getTheme())

  let cleanupTheme: (() => void) | null = null

  function updateTheme(newTheme: Theme) {
    theme.value = newTheme
  }

  function toggleTheme() {
    const newTheme = coreToggleTheme()
    theme.value = newTheme
    return newTheme
  }

  onMounted(() => {
    theme.value = getTheme()

    // onThemeChange handles both cross-tab storage events and system preference changes
    cleanupTheme = onThemeChange(updateTheme)
  })

  onUnmounted(() => {
    cleanupTheme?.()
  })

  return {
    theme,
    toggleTheme,
  }
}
