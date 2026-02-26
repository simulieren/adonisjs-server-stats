import React, { useState, useMemo } from 'react'
import type { DebugPane, DebugPanelProps } from '../../../../core/types.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { formatTime, timeAgo, formatDuration, compactPreview } from '../../../../core/formatters.js'

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
  const paneOptions: DebugPanelProps = {
    ...options,
    debugEndpoint: '', // Direct endpoint
  }

  const { data, isLoading, error, clearData } = useDebugData<any>(
    pane.endpoint.replace(/^\//, '') as any,
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
    let result = data
    for (const part of key.split('.')) {
      result = result?.[part]
    }
    return Array.isArray(result) ? result : []
  }, [data, pane.dataKey, pane.id])

  // Filter by search
  const filteredRows = useMemo(() => {
    if (!search) return rows
    const lower = search.toLowerCase()
    const searchableKeys = pane.columns.filter((c) => c.searchable).map((c) => c.key)
    if (searchableKeys.length === 0) return rows
    return rows.filter((row: any) =>
      searchableKeys.some((key) => {
        const val = row[key]
        return val != null && String(val).toLowerCase().includes(lower)
      })
    )
  }, [rows, search, pane.columns])

  const formatCell = (value: any, col: typeof pane.columns[0]): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span style={{ color: 'var(--ss-dim)' }}>-</span>
    }

    const fmt = col.format || 'text'
    switch (fmt) {
      case 'time':
        return typeof value === 'number' ? formatTime(value) : String(value)
      case 'timeAgo':
        return <span className="ss-dbg-event-time">{timeAgo(value)}</span>
      case 'duration': {
        const ms = typeof value === 'number' ? value : parseFloat(value)
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
            {value}
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
        return compactPreview(parsed, 80)
      }
      case 'badge': {
        const sv = String(value).toLowerCase()
        const colorMap = col.badgeColorMap || {}
        const color = colorMap[sv] || 'muted'
        return <span className={`ss-dbg-badge ss-dbg-badge-${color}`}>{value}</span>
      }
      default:
        return String(value)
    }
  }

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
        <table className="ss-dbg-table">
          <thead>
            <tr>
              {pane.columns.map((col) => (
                <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row: any, i: number) => (
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
