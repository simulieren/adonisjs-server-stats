import React, { useState } from 'react'

import { timeAgo } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { JsonViewer } from '../../shared/JsonViewer.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface EventsSectionProps {
  options?: DashboardHookOptions
}

export function EventsSection({ options = {} }: EventsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  const { data, meta, isLoading } = useDashboardData('events', { ...options, page, search })
  const events = (data as any[]) || []

  return (
    <div>
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter events..." />
      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading events...</div>
      ) : (
        <>
          <DataTable
            columns={[
              { key: 'id', label: '#', width: '40px' },
              {
                key: 'event_name',
                label: 'Event',
                render: (v: string) => <span style={{ color: 'var(--ss-sql-color)' }}>{v}</span>,
              },
              {
                key: 'data',
                label: 'Data',
                render: (v: any) => <JsonViewer data={v} maxPreviewLength={80} />,
              },
              {
                key: 'created_at',
                label: 'Time',
                width: '80px',
                render: (v: string) => <span className="ss-dash-event-time">{timeAgo(v)}</span>,
              },
            ]}
            data={events}
            emptyMessage="No events recorded"
          />
          {meta && (
            <Pagination
              page={meta.page}
              lastPage={meta.lastPage}
              total={meta.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}

export default EventsSection
