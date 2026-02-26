import { useState, useEffect, useCallback } from 'react'
import type { Theme } from '../../core/types.js'
import { getTheme, toggleTheme as coreToggle, onThemeChange } from '../../core/theme.js'

/**
 * React hook for theme state management.
 *
 * Wraps the core theme utilities with React state sync,
 * including cross-tab synchronization and system preference listening.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme())

  useEffect(() => {
    const unsubscribe = onThemeChange((newTheme) => {
      setThemeState(newTheme)
    })
    return unsubscribe
  }, [])

  const toggleTheme = useCallback(() => {
    const newTheme = coreToggle()
    setThemeState(newTheme)
    return newTheme
  }, [])

  return { theme, toggleTheme } as const
}
