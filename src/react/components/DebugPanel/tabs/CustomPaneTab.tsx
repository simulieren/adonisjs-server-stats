import React, { useState, useMemo, useRef, useEffect } from 'react'

import { formatTime, timeAgo, formatDuration, compactPreview } from '../../../../core/formatters.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import { useDebugData } from '../../../hooks/useDebugData.js'

import type { DebugPane, DebugPanelProps, DebugTab } from '../../../../core/types.js'

interface CustomPaneTabProps {
  pane: DebugPane
  options?: DebugPanelProps
}

/**
 * Config-driven custom pane renderer.
 *
 * Renders any user-registered custom pane based on its column
 * definitions, data endpoint, and formatting configuration.
 */
export function CustomPaneTab({ pane, options }: CustomPaneTabProps) {
  // Build custom endpoint options
  const _paneOptions: DebugPanelProps = {
    ...options,
    debugEndpoint: '', // Direct endpoint
  }

  const { data, isLoading, error, clearData } = useDebugData<Record<string, unknown>>(
    pane.endpoint.replace(/^\//, '') as DebugTab,
    {
      ...options,
      debugEndpoint: '', // Use endpoint directly
    }
  )
  const [search, setSearch] = useState('')

  // Extract data array from response using dataKey
  const rows = useMemo(() => {
    if (!data) return []
    const key = pane.dataKey || pane.id
    // Support dot notation
    let result: unknown = data
    for (const part of key.split('.')) {
      result = (result as Record<string, unknown>)?.[part]
    }
    return Array.isArray(result) ? result : []
  }, [data, pane.dataKey, pane.id])

  // Filter by search
  const filteredRows = useMemo(() => {
    if (!search) return rows
    const lower = search.toLowerCase()
    const searchableKeys = pane.columns.filter((c) => c.searchable).map((c) => c.key)
    if (searchableKeys.length === 0) return rows
    return rows.filter((row: Record<string, unknown>) =>
      searchableKeys.some((key) => {
        const val = row[key]
        return val !== null && String(val).toLowerCase().includes(lower)
      })
    )
  }, [rows, search, pane.columns])

  const formatCell = (value: unknown, col: (typeof pane.columns)[0]): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span style={{ color: 'var(--ss-dim)' }}>-</span>
    }

    const fmt = col.format || 'text'
    switch (fmt) {
      case 'time':
        return typeof value === 'number' ? formatTime(value) : String(value)
      case 'timeAgo':
        return <span className="ss-dbg-event-time">{timeAgo(value as string)}</span>
      case 'duration': {
        const ms = typeof value === 'number' ? value : parseFloat(String(value))
        if (isNaN(ms)) return String(value)
        return (
          <span
            className={`ss-dbg-duration ${ms > 500 ? 'ss-dbg-very-slow' : ms > 100 ? 'ss-dbg-slow' : ''}`}
          >
            {formatDuration(ms)}
          </span>
        )
      }
      case 'method':
        return (
          <span className={`ss-dbg-method ss-dbg-method-${String(value).toLowerCase()}`}>
            {String(value)}
          </span>
        )
      case 'json': {
        let parsed = value
        if (typeof value === 'string') {
          try {
            parsed = JSON.parse(value)
          } catch {
            /* use as-is */
          }
        }
        return compactPreview(parsed as Record<string, unknown>, 80)
      }
      case 'badge': {
        const sv = String(value).toLowerCase()
        const colorMap = col.badgeColorMap || {}
        const color = colorMap[sv] || 'muted'
        return <span className={`ss-dbg-badge ss-dbg-badge-${color}`}>{String(value)}</span>
      }
      default:
        return String(value)
    }
  }

  const tableRef = useRef<HTMLTableElement>(null)
  useEffect(() => {
    if (tableRef.current) {
      return initResizableColumns(tableRef.current)
    }
  }, [filteredRows])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading {pane.label}...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  return (
    <div>
      {/* Search bar */}
      {pane.search && (
        <div className="ss-dbg-search-bar">
          <input
            type="text"
            className="ss-dbg-search"
            placeholder={pane.search.placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="ss-dbg-summary">{filteredRows.length} items</span>
          {pane.clearable && (
            <button type="button" className="ss-dbg-btn-clear" onClick={clearData}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {filteredRows.length === 0 ? (
        <div className="ss-dbg-empty">No data</div>
      ) : (
        <table ref={tableRef} className="ss-dbg-table">
          <thead>
            <tr>
              {pane.columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, i) => (
              <tr key={row.id ?? i}>
                {pane.columns.map((col) => (
                  <td key={col.key}>{formatCell(row[col.key], col)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default CustomPaneTab
