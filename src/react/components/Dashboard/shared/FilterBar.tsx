import React, { useCallback } from 'react'

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
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
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
