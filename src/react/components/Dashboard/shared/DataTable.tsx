import React, { useCallback } from 'react'

import { useResizableTable } from '../../../hooks/useResizableTable.js'

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
  rowClassName?: string | ((row: T) => string)
  emptyMessage?: string
  className?: string
  renderAfterRow?: (row: T, index: number) => React.ReactNode
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
  rowClassName,
  emptyMessage = 'No data',
  className = '',
  renderAfterRow,
}: DataTableProps<T>) {
  const handleSort = useCallback(
    (key: string) => {
      if (onSort) onSort(key)
    },
    [onSort]
  )

  const tableRef = useResizableTable([data, columns])

  if (data.length === 0) {
    return <div className="ss-dash-empty">{emptyMessage}</div>
  }

  return (
    <table ref={tableRef} className={`ss-dash-table ${className}`}>
      <colgroup>
        {columns.map((col) => (
          <col key={col.key} style={col.width ? { width: col.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
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
        {data.map((row, i) => {
          const extraClass = rowClassName
            ? typeof rowClassName === 'function'
              ? rowClassName(row)
              : rowClassName
            : ''
          const clickClass = onRowClick ? 'ss-dash-clickable' : ''
          return (
          <React.Fragment key={row[keyField] ?? i}>
          <tr
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`${clickClass} ${extraClass}`.trim()}
          >
            {columns.map((col) => (
              <td key={col.key}>
                {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '-')}
              </td>
            ))}
          </tr>
          {renderAfterRow ? renderAfterRow(row, i) : null}
          </React.Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
