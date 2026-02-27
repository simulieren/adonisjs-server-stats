import React, { useState, useCallback } from 'react'

import { timeAgo, formatDuration } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { MethodBadge, StatusBadge } from '../../shared/Badge.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'
import { WaterfallChart } from '../shared/WaterfallChart.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface TimelineSectionProps {
  options?: DashboardHookOptions
}

export function TimelineSection({ options = {} }: TimelineSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data, meta, isLoading } = useDashboardData('traces', { ...options, page, search })
  const traces = (data as Record<string, unknown>[]) || []

  // Fetch individual trace detail
  const { data: traceDetail } = useDashboardData(
    selectedId ? `traces/${selectedId}` : 'traces',
    selectedId ? options : { ...options, page: 0 } // Only fetch when selected
  )

  const handleBack = useCallback(() => setSelectedId(null), [])

  if (selectedId && traceDetail) {
    const trace = traceDetail as any
    return (
      <div>
        <div className="ss-dash-detail-header">
          <button type="button" className="ss-dash-btn" onClick={handleBack}>
            Back
          </button>
          <MethodBadge method={trace.method || ''} />
          <span style={{ color: 'var(--ss-text)' }}>{trace.url}</span>
          <StatusBadge code={trace.status_code || trace.statusCode || 0} />
          <span style={{ color: 'var(--ss-dim)' }}>
            {formatDuration(trace.total_duration || trace.totalDuration || 0)}
          </span>
        </div>
        <WaterfallChart
          spans={trace.spans || []}
          totalDuration={trace.total_duration || trace.totalDuration || 0}
        />
        {trace.warnings && trace.warnings.length > 0 && (
          <div className="ss-dash-warnings">
            <h4>Warnings</h4>
            {trace.warnings.map((w: string, i: number) => (
              <div key={i} className="ss-dash-warning">
                {w}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter traces..." />
      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading traces...</div>
      ) : (
        <>
          <DataTable
            columns={[
              {
                key: 'method',
                label: 'Method',
                width: '70px',
                render: (v: string) => <MethodBadge method={v} />,
              },
              {
                key: 'url',
                label: 'URL',
                render: (v: string) => <span style={{ color: 'var(--ss-text)' }}>{v}</span>,
              },
              {
                key: 'status_code',
                label: 'Status',
                width: '60px',
                render: (v: number) => <StatusBadge code={v} />,
              },
              {
                key: 'total_duration',
                label: 'Duration',
                width: '80px',
                render: (v: number) => formatDuration(v),
              },
              { key: 'span_count', label: 'Spans', width: '50px' },
              {
                key: 'created_at',
                label: 'Time',
                width: '80px',
                render: (v: string) => <span className="ss-dash-event-time">{timeAgo(v)}</span>,
              },
            ]}
            data={traces}
            onRowClick={(row: Record<string, unknown>) => setSelectedId(row.id as number)}
            emptyMessage="No traces recorded"
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

export default TimelineSection
