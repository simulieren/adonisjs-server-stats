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

import type { DashboardHookOptions } from '../../../../core/types.js'
import type { TraceDetail } from '../../../../core/trace-utils.js'

interface TimelineSectionProps {
  options?: DashboardHookOptions
  /** When false, show a "tracing disabled" message instead of fetching. Defaults to true. */
  tracingEnabled?: boolean
}

export function TimelineSection({ options = {}, tracingEnabled = true }: TimelineSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const { data, meta, isLoading, error } = useDashboardData('traces', { ...options, page, search })
  const traces = (data as Record<string, unknown>[]) || []

  const getClient = useApiClient(options.baseUrl || '', options.authToken)

  // Fetch individual trace detail when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setTraceDetail(null)
      return
    }

    let cancelled = false
    setDetailLoading(true)

    const endpoint = options.dashboardEndpoint || '/__stats/api'
    getClient()
      .fetch<TraceDetail>(`${endpoint}/traces/${selectedId}`)
      .then((result) => {
        if (!cancelled) {
          setTraceDetail(result)
          setDetailLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetailLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedId, getClient, options.dashboardEndpoint])

  const handleBack = useCallback(() => setSelectedId(null), [])

  if (!tracingEnabled) {
    return (
      <div className="ss-dash-empty">
        Tracing is not enabled. Enable tracing in your server-stats config to use the timeline.
      </div>
    )
  }

  if (selectedId && traceDetail) {
    const normalized = normalizeTraceFields(traceDetail as unknown as Record<string, unknown>)

    return (
      <div>
        <div className="ss-dash-tl-detail-header">
          <button type="button" className="ss-dash-btn" onClick={handleBack}>
            ← Back
          </button>
          <MethodBadge method={normalized.method} />
          <span style={{ color: 'var(--ss-text)' }}>{normalized.url}</span>
          <StatusBadge code={normalized.statusCode} />
          <span className="ss-dash-tl-meta">
            {normalized.totalDuration.toFixed(1)}ms &middot; {normalized.spanCount} spans
          </span>
        </div>
        <WaterfallChart
          spans={normalized.spans}
          totalDuration={normalized.totalDuration}
          warnings={normalized.warnings}
        />
      </div>
    )
  }

  if (selectedId && detailLoading) {
    return (
      <div>
        <div className="ss-dash-tl-detail-header">
          <button type="button" className="ss-dash-btn" onClick={handleBack}>
            ← Back
          </button>
        </div>
        <div className="ss-dash-empty">Loading trace detail...</div>
      </div>
    )
  }

  return (
    <div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter traces..."
        summary={`${meta?.total ?? 0} traces`}
      />

      {error && <div className="ss-dash-empty">Failed to load traces</div>}

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading traces...</div>
      ) : (
        <>
          <div className="ss-dash-table-wrap">
            <DataTable
              columns={[
                {
                  key: 'id',
                  label: '#',
                  width: '40px',
                  render: (v: number) => <span style={{ color: 'var(--ss-dim)' }}>{v}</span>,
                },
                {
                  key: 'method',
                  label: 'Method',
                  width: '70px',
                  render: (v: string) => <MethodBadge method={v} />,
                },
                {
                  key: 'url',
                  label: 'URL',
                  render: (v: string) => (
                    <span
                      style={{
                        color: 'var(--ss-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={v}
                    >
                      {v}
                    </span>
                  ),
                },
                {
                  key: 'statusCode',
                  label: 'Status',
                  width: '60px',
                  render: (v: number) => <StatusBadge code={v} />,
                },
                {
                  key: 'totalDuration',
                  label: 'Duration',
                  width: '80px',
                  render: (v: number) => (
                    <span
                      className={`ss-dash-duration ${durationSeverity(v) === 'very-slow' ? 'ss-dash-very-slow' : durationSeverity(v) === 'slow' ? 'ss-dash-slow' : ''}`}
                    >
                      {v.toFixed(1)}ms
                    </span>
                  ),
                },
                {
                  key: 'spanCount',
                  label: 'Spans',
                  width: '50px',
                  render: (v: number) => (
                    <span style={{ color: 'var(--ss-muted)', textAlign: 'center' }}>{v}</span>
                  ),
                },
                {
                  key: 'createdAt',
                  label: 'Time',
                  width: '80px',
                  render: (v: string) => <span className="ss-dash-event-time" title={formatTime(v)}>{timeAgo(v)}</span>,
                },
              ]}
              data={traces}
              onRowClick={(row: Record<string, unknown>) => setSelectedId(row.id as number)}
              emptyMessage="No traces recorded"
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

export default TimelineSection
