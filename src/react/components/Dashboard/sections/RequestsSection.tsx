import React, { useState, useCallback } from 'react'

import { timeAgo, formatDuration } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { MethodBadge, StatusBadge } from '../../shared/Badge.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'
import { WaterfallChart } from '../shared/WaterfallChart.js'

import type { DashboardHookOptions, TraceRecord } from '../../../../core/types.js'

interface RequestsSectionProps {
  options?: DashboardHookOptions
}

export function RequestsSection({ options = {} }: RequestsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedTrace, setSelectedTrace] = useState<TraceRecord | null>(null)

  const { data, meta, isLoading } = useDashboardData('requests', {
    ...options,
    page,
    search,
    sort,
    sortDir,
  })

  const handleSort = useCallback(
    (key: string) => {
      if (sort === key) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      } else {
        setSort(key)
        setSortDir('desc')
      }
    },
    [sort]
  )

  const requests = (data as Record<string, unknown>[]) || []

  if (selectedTrace) {
    return (
      <div>
        <div className="ss-dash-detail-header">
          <button type="button" className="ss-dash-btn" onClick={() => setSelectedTrace(null)}>
            Back to Requests
          </button>
          <MethodBadge method={selectedTrace.method} />
          <span style={{ color: 'var(--ss-text)' }}>{selectedTrace.url}</span>
          <StatusBadge code={selectedTrace.statusCode} />
          <span style={{ color: 'var(--ss-dim)' }}>
            {formatDuration(selectedTrace.totalDuration)} | {selectedTrace.spanCount} spans
          </span>
        </div>
        <WaterfallChart
          spans={selectedTrace.spans || []}
          totalDuration={selectedTrace.totalDuration}
        />
      </div>
    )
  }

  return (
    <div>
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter requests..." />

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading requests...</div>
      ) : (
        <>
          <DataTable
            columns={[
              {
                key: 'method',
                label: 'Method',
                width: '70px',
                sortable: true,
                render: (v: string) => <MethodBadge method={v} />,
              },
              {
                key: 'url',
                label: 'URL',
                sortable: true,
                render: (v: string) => <span style={{ color: 'var(--ss-text)' }}>{v}</span>,
              },
              {
                key: 'status_code',
                label: 'Status',
                width: '60px',
                sortable: true,
                render: (v: number) => <StatusBadge code={v} />,
              },
              {
                key: 'duration',
                label: 'Duration',
                width: '80px',
                sortable: true,
                render: (v: number) => (
                  <span
                    className={`ss-dash-duration ${v > 500 ? 'ss-dash-very-slow' : v > 100 ? 'ss-dash-slow' : ''}`}
                  >
                    {formatDuration(v)}
                  </span>
                ),
              },
              { key: 'span_count', label: 'Spans', width: '50px' },
              {
                key: 'created_at',
                label: 'Time',
                width: '80px',
                sortable: true,
                render: (v: string) => <span className="ss-dash-event-time">{timeAgo(v)}</span>,
              },
            ]}
            data={requests}
            sort={sort}
            sortDir={sortDir}
            onSort={handleSort}
            onRowClick={(row: Record<string, unknown>) => setSelectedTrace(row as unknown as TraceRecord)}
            emptyMessage="No requests recorded"
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

export default RequestsSection
