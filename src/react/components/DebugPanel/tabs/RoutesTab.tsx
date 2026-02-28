import React, { useState, useMemo, useRef, useEffect } from 'react'

import { initResizableColumns } from '../../../../core/resizable-columns.js'
import { useDebugData } from '../../../hooks/useDebugData.js'

import type { RouteRecord, DebugPanelProps } from '../../../../core/types.js'

interface RoutesTabProps {
  options?: DebugPanelProps
  currentPath?: string
}

export function RoutesTab({ options, currentPath }: RoutesTabProps) {
  const { data, isLoading, error } = useDebugData<{ routes: RouteRecord[] }>('routes', options)
  const [search, setSearch] = useState('')

  const routes = useMemo(() => {
    const items = data?.routes || []
    if (!search) return items
    const lower = search.toLowerCase()
    return items.filter(
      (r) =>
        r.pattern.toLowerCase().includes(lower) ||
        r.handler.toLowerCase().includes(lower) ||
        r.method.toLowerCase().includes(lower) ||
        (r.name && r.name.toLowerCase().includes(lower))
    )
  }, [data, search])

  const tableRef = useRef<HTMLTableElement>(null)
  useEffect(() => {
    if (tableRef.current) {
      return initResizableColumns(tableRef.current)
    }
  }, [routes])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading routes...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  return (
    <div>
      <div className="ss-dbg-search-bar">
        <input
          type="text"
          className="ss-dbg-search"
          placeholder="Filter routes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ss-dbg-summary">{routes.length} routes</span>
      </div>

      {routes.length === 0 ? (
        <div className="ss-dbg-empty">No routes found</div>
      ) : (
        <table ref={tableRef} className="ss-dbg-table">
          <colgroup>
            <col style={{ width: '70px' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '15%' }} />
            <col />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Method</th>
              <th>Pattern</th>
              <th>Name</th>
              <th>Handler</th>
              <th>Middleware</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route, i) => {
              const isCurrentRoute = currentPath && (
                route.pattern === currentPath ||
                new RegExp('^' + route.pattern.replace(/:[^/]+/g, '[^/]+') + '$').test(currentPath)
              )
              return (
                <tr
                  key={`${route.method}-${route.pattern}-${i}`}
                  className={isCurrentRoute ? 'ss-dbg-current-route' : ''}
                >
                  <td>
                    <span className={`ss-dbg-method ss-dbg-method-${route.method.toLowerCase()}`}>
                      {route.method}
                    </span>
                  </td>
                  <td className="ss-dbg-c-text">{route.pattern}</td>
                  <td className="ss-dbg-c-muted">{route.name || '-'}</td>
                  <td className="ss-dbg-c-sql">{route.handler}</td>
                  <td className="ss-dbg-c-dim" style={{ fontSize: '10px' }}>
                    {route.middleware.length > 0 ? route.middleware.join(', ') : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default RoutesTab
