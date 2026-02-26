import React, { useState, useMemo } from 'react'

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
        <table className="ss-dbg-table">
          <thead>
            <tr>
              <th style={{ width: '70px' }}>Method</th>
              <th>Pattern</th>
              <th style={{ width: '90px' }}>Name</th>
              <th>Handler</th>
              <th>Middleware</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route, i) => {
              const isCurrentRoute = currentPath && route.pattern === currentPath
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
                  <td style={{ color: 'var(--ss-text)' }}>{route.pattern}</td>
                  <td style={{ color: 'var(--ss-dim)' }}>{route.name || '-'}</td>
                  <td style={{ color: 'var(--ss-text-secondary)' }}>{route.handler}</td>
                  <td style={{ color: 'var(--ss-dim)', fontSize: '10px' }}>
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
