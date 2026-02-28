import React, { useState, useCallback, useEffect, useRef } from 'react'

import { ApiClient } from '../../../../core/api-client.js'
import { timeAgo, formatTime } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { MethodBadge, StatusBadge } from '../../shared/Badge.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'
import { WaterfallChart } from '../shared/WaterfallChart.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface RequestsSectionProps {
  options?: DashboardHookOptions
}

interface TraceDetail {
  method?: string
  url?: string
  status_code?: number
  statusCode?: number
  total_duration?: number
  totalDuration?: number
  duration?: number
  spanCount?: number
  span_count?: number
  spans: Array<{
    id: string
    label: string
    startOffset: number
    duration: number
    category: string
    parentId?: string
    metadata?: Record<string, unknown>
  }> | string
  warnings: string[] | string
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

  const clientRef = useRef<ApiClient | null>(null)
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new ApiClient({
        baseUrl: options.baseUrl || '',
        authToken: options.authToken,
      })
    }
    return clientRef.current
  }, [options.baseUrl, options.authToken])

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
    // Parse spans from string if they come as JSON strings
    let spans: TraceDetail['spans'] = selectedTrace.spans
    if (typeof spans === 'string') {
      try {
        spans = JSON.parse(spans)
      } catch {
        spans = []
      }
    }
    const parsedSpans = (Array.isArray(spans) ? spans : []) as Array<{
      id: string
      label: string
      startOffset: number
      duration: number
      category: 'request' | 'middleware' | 'db' | 'view' | 'mail' | 'event' | 'custom'
      parentId: string | null
      metadata?: Record<string, unknown>
    }>

    // Parse warnings from string if they come as JSON strings
    let warnings: TraceDetail['warnings'] = selectedTrace.warnings
    if (typeof warnings === 'string') {
      try {
        warnings = JSON.parse(warnings)
      } catch {
        warnings = []
      }
    }
    const parsedWarnings = (Array.isArray(warnings) ? warnings : []) as string[]

    const statusCode = selectedTrace.status_code || selectedTrace.statusCode || 0
    const duration = selectedTrace.total_duration || selectedTrace.totalDuration || selectedTrace.duration || 0
    const spanCount = selectedTrace.span_count || selectedTrace.spanCount || 0

    return (
      <div>
        <div className="ss-dash-tl-detail-header">
          <button type="button" className="ss-dash-btn" onClick={() => setSelectedTrace(null)}>
            ← Back to Requests
          </button>
          <MethodBadge method={selectedTrace.method || ''} />
          <span style={{ color: 'var(--ss-text)' }}>{selectedTrace.url}</span>
          <StatusBadge code={statusCode} />
          <span className="ss-dash-tl-meta">
            {duration.toFixed(1)}ms &middot; {spanCount} spans
          </span>
        </div>
        <WaterfallChart
          spans={parsedSpans}
          totalDuration={duration}
          warnings={parsedWarnings}
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
                  render: (v: unknown) => <span style={{ color: 'var(--ss-dim)' }}>{v as number}</span>,
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
                    const code = (row as Record<string, unknown>).status_code || (row as Record<string, unknown>).statusCode || row.statusCode
                    return <StatusBadge code={code as number} />
                  },
                },
                {
                  key: 'duration',
                  label: 'Duration',
                  width: '80px',
                  sortable: true,
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const dur = ((row as Record<string, unknown>).total_duration || (row as Record<string, unknown>).totalDuration || (row as Record<string, unknown>).duration || 0) as number
                    return (
                      <span
                        className={`ss-dash-duration ${dur > 500 ? 'ss-dash-very-slow' : dur > 100 ? 'ss-dash-slow' : ''}`}
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
                    const count = ((row as Record<string, unknown>).span_count || (row as Record<string, unknown>).spanCount || 0) as number
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
                    const count = ((row as Record<string, unknown>).warning_count || (row as Record<string, unknown>).warningCount || 0) as number
                    return count > 0 ? (
                      <span style={{ color: 'var(--ss-amber-fg)', textAlign: 'center', display: 'block' }}>{count}</span>
                    ) : (
                      <span style={{ color: 'var(--ss-dim)', textAlign: 'center', display: 'block' }}>-</span>
                    )
                  },
                },
                {
                  key: 'createdAt',
                  label: 'Time',
                  width: '80px',
                  sortable: true,
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const val = ((row as Record<string, unknown>).createdAt || (row as Record<string, unknown>).created_at || (row as Record<string, unknown>).timestamp || '') as string
                    return <span className="ss-dash-event-time" title={formatTime(val)}>{timeAgo(val)}</span>
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
