import React, { useState, useEffect } from 'react'

import { resolveEventName, resolveTimestamp } from '../../../../core/field-resolvers.js'
import { TimeAgoCell } from '../../shared/TimeAgoCell.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { JsonViewer } from '../../shared/JsonViewer.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface EventsSectionProps {
  options?: DashboardHookOptions
}

export function EventsSection({ options = {} }: EventsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  const { data, meta, isLoading } = useDashboardData('events', { ...options, page, search })
  const events = (data as Record<string, unknown>[]) || []

  useEffect(() => setPage(1), [search])

  return (
    <div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter events..."
        summary={`${meta?.total ?? 0} events`}
      />
      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading events...</div>
      ) : (
        <>
          <div className="ss-dash-table-wrap">
            <DataTable
              columns={[
                {
                  key: 'id',
                  label: '#',
                  width: '40px',
                  render: (v: unknown) => (
                    <span style={{ color: 'var(--ss-dim)' }}>{v as string}</span>
                  ),
                },
                {
                  key: 'eventName',
                  label: 'Event',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const name = resolveEventName(row)
                    return (
                      <span
                        className="ss-dash-event-name"
                        title={name}
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {name}
                      </span>
                    )
                  },
                },
                {
                  key: 'data',
                  label: 'Data',
                  render: (v: unknown) => (
                    <JsonViewer data={v} maxPreviewLength={80} className="ss-dash-event-data" />
                  ),
                },
                {
                  key: 'createdAt',
                  label: 'Time',
                  width: '80px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const ts = resolveTimestamp(row) as string
                    return <TimeAgoCell ts={ts} className="ss-dash-event-time" />
                  },
                },
              ]}
              data={events}
              emptyMessage="No events recorded yet"
            />
          </div>
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
