import React, { useCallback } from 'react'
import { TAB_ICONS } from '../../../../core/icons.js'

interface FilterBarProps {
  search: string
  onSearchChange: (value: string) => void
  placeholder?: string
  summary?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

/**
 * Search/filter bar with optional summary text and additional controls.
 * Matches the old vanilla JS `.ss-dash-search-bar` layout:
 *   [summary] [search input] [extra controls]
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
    <div className={`ss-dash-filter-bar ${className}`}>
      {summary !== null && summary !== undefined && <span className="ss-dash-summary">{summary}</span>}
      <div className="ss-dash-search-wrapper">
        <svg
          className="ss-dash-search-icon"
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
          className="ss-dash-search"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button type="button" className="ss-dash-search-clear" onClick={handleClear}>
            {'\u00D7'}
          </button>
        )}
      </div>
      {children && <div className="ss-dash-filter-controls">{children}</div>}
    </div>
  )
}
