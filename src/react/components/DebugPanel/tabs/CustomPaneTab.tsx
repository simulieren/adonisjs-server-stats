import React, { useState, useMemo } from 'react'

import {
  formatDuration,
  compactPreview,
  durationClassName,
} from '../../../../core/formatters.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { TimeAgoCell } from '../../shared/TimeAgoCell.js'
import { useResizableTable } from '../../../hooks/useResizableTable.js'
import { Badge, MethodBadge } from '../../shared/Badge.js'
import { FilterBar } from '../../shared/FilterBar.js'

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
      return <span className="ss-dbg-c-dim">-</span>
    }

    const fmt = col.format || 'text'
    switch (fmt) {
      case 'time':
        return typeof value === 'number' ? (
          <TimeAgoCell ts={value} className="ss-dbg-event-time" />
        ) : (
          <span className="ss-dbg-event-time">{String(value)}</span>
        )
      case 'timeAgo':
        return <TimeAgoCell ts={value as string} className="ss-dbg-event-time" />
      case 'duration': {
        const ms = typeof value === 'number' ? value : parseFloat(String(value))
        if (isNaN(ms)) return String(value)
        return (
          <span
            className={`ss-dbg-duration ${durationClassName(ms, 'ss-dbg')}`}
          >
            {formatDuration(ms)}
          </span>
        )
      }
      case 'method':
        return <MethodBadge method={String(value)} classPrefix="ss-dbg" />
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
        return (
          <Badge color={color} classPrefix="ss-dbg">
            {String(value)}
          </Badge>
        )
      }
      default:
        return String(value)
    }
  }

  const tableRef = useResizableTable([filteredRows])

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
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          placeholder={pane.search.placeholder}
          summary={`${filteredRows.length} items`}
        >
          {pane.clearable && (
            <button type="button" className="ss-dbg-btn-clear" onClick={clearData}>
              Clear
            </button>
          )}
        </FilterBar>
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
