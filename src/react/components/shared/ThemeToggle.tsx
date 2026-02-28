import React from 'react'

import type { Theme } from '../../../core/types.js'
import { TAB_ICONS } from '../../../core/icons.js'

interface ThemeToggleProps {
  theme: Theme
  onToggle: () => void
  className?: string
  classPrefix?: 'ss-dash' | 'ss-dbg'
}

/**
 * Sun/moon toggle button for switching between light and dark themes.
 */
export function ThemeToggle({ theme, onToggle, className = '', classPrefix = 'ss-dash' }: ThemeToggleProps) {
  const isDark = theme === 'dark'
  const baseClass = classPrefix === 'ss-dbg' ? 'ss-dbg-theme-toggle' : 'ss-dash-theme-btn'

  return (
    <button
      type="button"
      className={`${baseClass} ${className}`}
      onClick={onToggle}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? (
        // Sun icon
        <svg
          width="16"
          height="16"
          viewBox={TAB_ICONS.sun.viewBox}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: TAB_ICONS.sun.elements.join('') }}
        />
      ) : (
        // Moon icon
        <svg
          width="16"
          height="16"
          viewBox={TAB_ICONS.moon.viewBox}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: TAB_ICONS.moon.elements.join('') }}
        />
      )}
    </button>
  )
}
