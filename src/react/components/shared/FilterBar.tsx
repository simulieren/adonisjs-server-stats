import React, { useCallback } from 'react'

import { TAB_ICONS } from '../../../core/icons.js'

interface FilterBarProps {
  search: string
  onSearchChange: (value: string) => void
  placeholder?: string
  summary?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

/**
 * Shared search/filter bar used by both Dashboard sections and DebugPanel tabs.
 * Uses the `ss-dbg-` CSS class namespace for consistent styling across both UIs.
 *
 * Layout: [summary] [search input with icon + clear] [extra controls via children]
 */
export function FilterBar({
  search,
  onSearchChange,
  placeholder = 'Search...',
  summary,
  children,
  className = '',
}: FilterBarProps) {
  const handleClear = useCallback(() => {
    onSearchChange('')
  }, [onSearchChange])

  return (
    <div className={`ss-dbg-filter-bar ${className}`}>
      {summary !== null && summary !== undefined && (
        <span className="ss-dbg-summary">{summary}</span>
      )}
      <div className="ss-dbg-search-wrapper">
        <svg
          className="ss-dbg-search-icon"
          width="14"
          height="14"
          viewBox={TAB_ICONS.search.viewBox}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: TAB_ICONS.search.elements.join('') }}
        />
        <input
          type="text"
          className="ss-dbg-search"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button type="button" className="ss-dbg-search-clear" onClick={handleClear}>
            {'\u00D7'}
          </button>
        )}
      </div>
      {children && <div className="ss-dbg-filter-controls">{children}</div>}
    </div>
  )
}
