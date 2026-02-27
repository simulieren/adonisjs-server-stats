import React, { useCallback, useRef, useEffect } from 'react'

import { initResizableColumns } from '../../../../core/resizable-columns.js'

interface Column<T> {
  key: string
  label: string
  width?: string
  render?: (value: unknown, row: T) => React.ReactNode
  sortable?: boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyField?: string
  sort?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string) => void
  onRowClick?: (row: T) => void
  emptyMessage?: string
  className?: string
}

/**
 * Reusable data table component for dashboard sections.
 */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField = 'id',
  sort,
  sortDir,
  onSort,
  onRowClick,
  emptyMessage = 'No data',
  className = '',
}: DataTableProps<T>) {
  const handleSort = useCallback(
    (key: string) => {
      if (onSort) onSort(key)
    },
    [onSort]
  )

  const tableRef = useRef<HTMLTableElement>(null)

  useEffect(() => {
    if (tableRef.current) {
      return initResizableColumns(tableRef.current)
    }
  }, [data, columns])

  if (data.length === 0) {
    return <div className="ss-dash-empty">{emptyMessage}</div>
  }

  return (
    <table ref={tableRef} className={`ss-dash-table ${className}`}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              style={col.width ? { minWidth: col.width } : undefined}
              onClick={col.sortable ? () => handleSort(col.key) : undefined}
              className={col.sortable ? 'ss-dash-sortable' : ''}
            >
              {col.label}
              {sort === col.key && (
                <span className="ss-dash-sort-arrow">
                  {sortDir === 'asc' ? ' \u25B2' : ' \u25BC'}
                </span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr
            key={row[keyField] ?? i}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={onRowClick ? 'ss-dash-clickable' : ''}
          >
            {columns.map((col) => (
              <td key={col.key}>
                {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '-')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
