import React, { useState, useCallback, useEffect } from 'react'

import { timeAgo, formatTime, durationSeverity } from '../../../../core/formatters.js'
import { normalizeTraceFields } from '../../../../core/trace-utils.js'
import { useApiClient } from '../../../hooks/useApiClient.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { MethodBadge, StatusBadge } from '../../shared/Badge.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'
import { WaterfallChart } from '../shared/WaterfallChart.js'

import type { TraceDetail } from '../../../../core/trace-utils.js'
import type { DashboardHookOptions, TraceSpan } from '../../../../core/types.js'

interface RequestsSectionProps {
  options?: DashboardHookOptions
}

export function RequestsSection({ options = {} }: RequestsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedTrace, setSelectedTrace] = useState<TraceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => setPage(1), [search])

  const { data, meta, isLoading, error } = useDashboardData('requests', {
    ...options,
    page,
    search,
    sort,
    sortDir,
  })

  const getClient = useApiClient(options.baseUrl || '', options.authToken)

  const handleRowClick = useCallback(
    (row: Record<string, unknown>) => {
      const id = row.id as number
      setDetailLoading(true)

      const endpoint = options.dashboardEndpoint || '/__stats/api'
      getClient()
        .fetch<TraceDetail>(`${endpoint}/requests/${id}`)
        .then((result) => {
          setSelectedTrace(result)
          setDetailLoading(false)
        })
        .catch(() => {
          setDetailLoading(false)
        })
    },
    [getClient, options.dashboardEndpoint]
  )

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
    const normalized = normalizeTraceFields(selectedTrace as unknown as Record<string, unknown>)

    return (
      <div>
        <div className="ss-dash-tl-detail-header">
          <button type="button" className="ss-dash-btn" onClick={() => setSelectedTrace(null)}>
            ← Back to Requests
          </button>
          <MethodBadge method={normalized.method} />
          <span style={{ color: 'var(--ss-text)' }}>{normalized.url}</span>
          <StatusBadge code={normalized.statusCode} />
          <span className="ss-dash-tl-meta">
            {normalized.totalDuration.toFixed(1)}ms &middot; {normalized.spanCount} spans
          </span>
        </div>
        <WaterfallChart
          spans={normalized.spans as TraceSpan[]}
          totalDuration={normalized.totalDuration}
          warnings={normalized.warnings}
        />
      </div>
    )
  }

  if (detailLoading) {
    return (
      <div>
        <div className="ss-dash-tl-detail-header">
          <button type="button" className="ss-dash-btn" onClick={() => setDetailLoading(false)}>
            ← Back to Requests
          </button>
        </div>
        <div className="ss-dash-empty">Loading request detail...</div>
      </div>
    )
  }

  return (
    <div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter requests..."
        summary={`${meta?.total ?? 0} requests`}
      />

      {error && <div className="ss-dash-empty">Failed to load requests</div>}

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading requests...</div>
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
                    <span style={{ color: 'var(--ss-dim)' }}>{v as number}</span>
                  ),
                },
                {
                  key: 'method',
                  label: 'Method',
                  width: '70px',
                  sortable: true,
                  render: (v: unknown) => <MethodBadge method={v as string} />,
                },
                {
                  key: 'url',
                  label: 'URL',
                  sortable: true,
                  render: (v: unknown) => (
                    <span
                      style={{
                        color: 'var(--ss-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={v as string}
                    >
                      {v as string}
                    </span>
                  ),
                },
                {
                  key: 'statusCode',
                  label: 'Status',
                  width: '60px',
                  sortable: true,
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const code =
                      (row as Record<string, unknown>).status_code ||
                      (row as Record<string, unknown>).statusCode ||
                      row.statusCode
                    return <StatusBadge code={code as number} />
                  },
                },
                {
                  key: 'duration',
                  label: 'Duration',
                  width: '80px',
                  sortable: true,
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const dur = ((row as Record<string, unknown>).total_duration ||
                      (row as Record<string, unknown>).totalDuration ||
                      (row as Record<string, unknown>).duration ||
                      0) as number
                    return (
                      <span
                        className={`ss-dash-duration ${durationSeverity(dur) === 'very-slow' ? 'ss-dash-very-slow' : durationSeverity(dur) === 'slow' ? 'ss-dash-slow' : ''}`}
                      >
                        {dur.toFixed(1)}ms
                      </span>
                    )
                  },
                },
                {
                  key: 'spanCount',
                  label: 'Spans',
                  width: '50px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const count = ((row as Record<string, unknown>).span_count ||
                      (row as Record<string, unknown>).spanCount ||
                      0) as number
                    return (
                      <span style={{ color: 'var(--ss-muted)', textAlign: 'center' }}>{count}</span>
                    )
                  },
                },
                {
                  key: 'warningCount',
                  label: '\u26A0',
                  width: '40px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const count = ((row as Record<string, unknown>).warning_count ||
                      (row as Record<string, unknown>).warningCount ||
                      0) as number
                    return count > 0 ? (
                      <span
                        style={{
                          color: 'var(--ss-amber-fg)',
                          textAlign: 'center',
                          display: 'block',
                        }}
                      >
                        {count}
                      </span>
                    ) : (
                      <span
                        style={{ color: 'var(--ss-dim)', textAlign: 'center', display: 'block' }}
                      >
                        -
                      </span>
                    )
                  },
                },
                {
                  key: 'createdAt',
                  label: 'Time',
                  width: '80px',
                  sortable: true,
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const val = ((row as Record<string, unknown>).createdAt ||
                      (row as Record<string, unknown>).created_at ||
                      (row as Record<string, unknown>).timestamp ||
                      '') as string
                    return (
                      <span className="ss-dash-event-time" title={formatTime(val)}>
                        {timeAgo(val)}
                      </span>
                    )
                  },
                },
              ]}
              data={requests}
              sort={sort}
              sortDir={sortDir}
              onSort={handleSort}
              onRowClick={handleRowClick}
              emptyMessage="No requests recorded yet"
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

export default RequestsSection
