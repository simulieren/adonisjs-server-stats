import React, { useState, useCallback } from 'react'

import { timeAgo, formatDuration, formatTime } from '../../../../core/formatters.js'
import {
  JOB_STATUS_FILTERS,
  getJobStatusBadgeColor,
  extractJobs,
  extractJobStats,
} from '../../../../core/job-utils.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { Badge } from '../../shared/Badge.js'
import { JsonViewer } from '../../shared/JsonViewer.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'

import type { BadgeColor, DashboardHookOptions } from '../../../../core/types.js'

interface JobsSectionProps {
  options?: DashboardHookOptions
}

export function JobsSection({ options = {} }: JobsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [retryStates, setRetryStates] = useState<Record<string, 'pending' | 'success' | 'error'>>({})

  const filters: Record<string, string> = {}
  if (statusFilter !== 'all') filters.status = statusFilter

  const { data, meta, isLoading, error, refresh, mutate } = useDashboardData('jobs', {
    ...options,
    page,
    search,
    filters,
  })

  const jobs = extractJobs(data)
  const stats = extractJobStats(data)

  const handleRetry = useCallback(
    async (jobId: string) => {
      setRetryStates((prev) => ({ ...prev, [jobId]: 'pending' }))
      try {
        await mutate(`jobs/${jobId}/retry`)
        setRetryStates((prev) => ({ ...prev, [jobId]: 'success' }))
        setTimeout(() => {
          setRetryStates((prev) => {
            const next = { ...prev }
            delete next[jobId]
            return next
          })
          refresh()
        }, 1000)
      } catch {
        setRetryStates((prev) => {
          const next = { ...prev }
          delete next[jobId]
          return next
        })
      }
    },
    [mutate, refresh]
  )

  return (
    <div>
      {/* Stats row */}
      {stats && (
        <div className="ss-dash-job-stats">
          <div className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Active:</span>
            <span className="ss-dash-job-stat-value">{stats.active ?? 0}</span>
          </div>
          <div className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Waiting:</span>
            <span className="ss-dash-job-stat-value">{stats.waiting ?? 0}</span>
          </div>
          <div className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Delayed:</span>
            <span className="ss-dash-job-stat-value">{stats.delayed ?? 0}</span>
          </div>
          <div className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Completed:</span>
            <span className="ss-dash-job-stat-value">{stats.completed ?? 0}</span>
          </div>
          <div className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Failed:</span>
            <span className="ss-dash-job-stat-value" style={{ color: 'var(--ss-red-fg)' }}>{stats.failed ?? 0}</span>
          </div>
        </div>
      )}

      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter jobs..." summary={`${meta?.total ?? jobs.length} jobs`}>
        <div className="ss-dash-btn-group">
          {JOB_STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              className={`ss-dash-btn ${statusFilter === status ? 'ss-dash-active' : ''}`}
              onClick={() => {
                setStatusFilter(status)
                setPage(1)
              }}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </FilterBar>

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading jobs...</div>
      ) : error ? (
        <div className="ss-dash-empty">Jobs/Queue not available</div>
      ) : (
        <>
          <div className="ss-dash-table-wrap">
            <DataTable
              columns={[
                {
                  key: 'id',
                  label: 'ID',
                  width: '40px',
                  render: (v: string) => <span style={{ color: 'var(--ss-dim)' }}>{v}</span>,
                },
                {
                  key: 'name',
                  label: 'Name',
                  render: (v: string) => (
                    <span style={{ color: 'var(--ss-text)' }} title={v}>
                      {v}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  width: '90px',
                  render: (v: string) => (
                    <Badge color={getJobStatusBadgeColor(v) as BadgeColor}>{v}</Badge>
                  ),
                },
                {
                  key: 'payload',
                  label: 'Payload',
                  render: (v: unknown, row: Record<string, unknown>) => (
                    <JsonViewer data={v || row?.data} maxPreviewLength={60} />
                  ),
                },
                {
                  key: 'attempts',
                  label: 'Tries',
                  width: '50px',
                  render: (v: number, row: Record<string, unknown>) => (
                    <span
                      style={{
                        color: 'var(--ss-muted)',
                        textAlign: 'center',
                        display: 'block',
                      }}
                    >
                      {v || (row.attemptsMade as number) || 0}
                    </span>
                  ),
                },
                {
                  key: 'duration',
                  label: 'Duration',
                  width: '75px',
                  render: (v: number | null) => (
                    <span className="ss-dash-duration">
                      {v !== null ? formatDuration(v) : '-'}
                    </span>
                  ),
                },
                {
                  key: 'timestamp',
                  label: 'Time',
                  width: '70px',
                  render: (v: unknown, row: Record<string, unknown>) => {
                    const ts = (v || row?.createdAt || row?.processedAt || row?.created_at) as string
                    return (
                      <span className="ss-dash-event-time" style={{ whiteSpace: 'nowrap' }} title={formatTime(ts)}>
                        {timeAgo(ts)}
                      </span>
                    )
                  },
                },
                {
                  key: '_actions',
                  label: '',
                  width: '50px',
                  render: (_: unknown, row: Record<string, unknown>) => {
                    const jobId = row.id as string
                    const retryState = retryStates[jobId]
                    if (row.status !== 'failed') return null
                    return (
                      <button
                        type="button"
                        className="ss-dash-retry-btn"
                        disabled={retryState === 'pending' || retryState === 'success'}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRetry(jobId)
                        }}
                      >
                        {retryState === 'pending' ? '...' : retryState === 'success' ? 'OK' : 'Retry'}
                      </button>
                    )
                  },
                },
              ]}
              data={jobs}
              emptyMessage="No jobs found"
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

export default JobsSection
