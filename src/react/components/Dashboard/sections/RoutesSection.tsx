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
  const { data, isLoading } = useDashboardData('routes', { ...options, search })
  const routes = (data as any[]) || []

  return (
    <div>
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter routes..." />
      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading routes...</div>
      ) : (
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
              render: (v: string) => <span style={{ color: 'var(--ss-text)' }}>{v}</span>,
            },
            { key: 'name', label: 'Name', width: '120px' },
            { key: 'handler', label: 'Handler' },
            {
              key: 'middleware',
              label: 'Middleware',
              render: (v: string[]) => v?.join(', ') || '-',
            },
          ]}
          data={routes}
          keyField="pattern"
          emptyMessage="No routes found"
        />
      )}
    </div>
  )
}

export default RoutesSection
