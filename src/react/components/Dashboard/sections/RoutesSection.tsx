import React, { useState } from 'react'

import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { MethodBadge } from '../../shared/Badge.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface RoutesSectionProps {
  options?: DashboardHookOptions
}

export function RoutesSection({ options = {} }: RoutesSectionProps) {
  const [search, setSearch] = useState('')
  const { data, isLoading, error } = useDashboardData('routes', { ...options, search })
  const raw = data as Record<string, unknown> | Record<string, unknown>[] | null
  const routes: Record<string, unknown>[] = Array.isArray(raw)
    ? raw
    : raw && Array.isArray((raw as Record<string, unknown>).routes)
      ? ((raw as Record<string, unknown>).routes as Record<string, unknown>[])
      : raw && Array.isArray((raw as Record<string, unknown>).data)
        ? ((raw as Record<string, unknown>).data as Record<string, unknown>[])
        : []

  const truncStyle: React.CSSProperties = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  return (
    <div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter routes..."
        summary={`${routes.length} routes`}
      />
      {error ? (
        <div className="ss-dash-empty">Failed to load routes</div>
      ) : isLoading && !data ? (
        <div className="ss-dash-empty">Loading routes...</div>
      ) : (
        <>
          <div className="ss-dash-table-wrap">
            <DataTable
              columns={[
                {
                  key: 'method',
                  label: 'Method',
                  width: '70px',
                  render: (v: string) => <MethodBadge method={v} />,
                },
                {
                  key: 'pattern',
                  label: 'Pattern',
                  render: (v: string) => (
                    <span style={{ color: 'var(--ss-text)', ...truncStyle }} title={v}>
                      {v}
                    </span>
                  ),
                },
                {
                  key: 'name',
                  label: 'Name',
                  width: '120px',
                  render: (v: string) => (
                    <span style={{ color: 'var(--ss-muted)', ...truncStyle }} title={v || '-'}>
                      {v || '-'}
                    </span>
                  ),
                },
                {
                  key: 'handler',
                  label: 'Handler',
                  render: (v: string) => (
                    <span style={{ color: 'var(--ss-sql-color)', ...truncStyle }} title={v}>
                      {v}
                    </span>
                  ),
                },
                {
                  key: 'middleware',
                  label: 'Middleware',
                  render: (v: string[]) => {
                    const text = v?.length ? v.join(', ') : '-'
                    return (
                      <span
                        style={{ color: 'var(--ss-dim)', fontSize: '10px', ...truncStyle }}
                        title={text}
                      >
                        {text}
                      </span>
                    )
                  },
                },
              ]}
              data={routes}
              keyField="pattern"
              emptyMessage="No routes available"
            />
          </div>
        </>
      )}
    </div>
  )
}

export default RoutesSection
