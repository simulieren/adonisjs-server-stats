import React, { useState, useCallback } from 'react'

import { timeAgo, formatDuration } from '../../../../core/formatters.js'
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

const JOB_STATUSES = ['all', 'active', 'waiting', 'delayed', 'completed', 'failed'] as const

export function JobsSection({ options = {} }: JobsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filters: Record<string, string> = {}
  if (statusFilter !== 'all') filters.status = statusFilter

  const { data, meta, isLoading, mutate } = useDashboardData('jobs', {
    ...options,
    page,
    search,
    filters,
  })

  const jobsData = data as any
  const jobs = jobsData?.jobs || (Array.isArray(data) ? data : [])
  const stats = jobsData?.stats || jobsData?.overview

  const handleRetry = useCallback(
    async (jobId: string) => {
      try {
        await mutate(`jobs/${jobId}/retry`)
      } catch {
        // Silently fail
      }
    },
    [mutate]
  )

  const statusColor: Record<string, string> = {
    active: 'blue',
    waiting: 'amber',
    delayed: 'purple',
    completed: 'green',
    failed: 'red',
  }

  return (
    <div>
      {/* Stats row */}
      {stats && (
        <div className="ss-dash-job-stats">
          <span className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Active:</span>
            <span className="ss-dash-job-stat-value">{stats.active ?? 0}</span>
          </span>
          <span className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Waiting:</span>
            <span className="ss-dash-job-stat-value">{stats.waiting ?? 0}</span>
          </span>
          <span className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Delayed:</span>
            <span className="ss-dash-job-stat-value">{stats.delayed ?? 0}</span>
          </span>
          <span className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Completed:</span>
            <span className="ss-dash-job-stat-value">{stats.completed ?? 0}</span>
          </span>
          <span className="ss-dash-job-stat">
            <span className="ss-dash-job-stat-label">Failed:</span>
            <span className="ss-dash-job-stat-value">{stats.failed ?? 0}</span>
          </span>
        </div>
      )}

      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter jobs...">
        <div className="ss-dash-level-filters">
          {JOB_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`ss-dash-filter-btn ${statusFilter === status ? 'ss-dash-active' : ''}`}
              onClick={() => {
                setStatusFilter(status)
                setPage(1)
              }}
            >
              {status}
            </button>
          ))}
        </div>
      </FilterBar>

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading jobs...</div>
      ) : (
        <>
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
                  <Badge color={(statusColor[v] || 'muted') as BadgeColor}>{v}</Badge>
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
                render: (v: number) => (
                  <span
                    style={{
                      color: 'var(--ss-muted)',
                      textAlign: 'center',
                      display: 'block',
                    }}
                  >
                    {v}
                  </span>
                ),
              },
              {
                key: 'duration',
                label: 'Duration',
                width: '75px',
                render: (v: number | null) => (v !== null ? formatDuration(v) : '-'),
              },
              {
                key: 'timestamp',
                label: 'Time',
                width: '70px',
                render: (v: unknown, row: Record<string, unknown>) => (
                  <span className="ss-dash-event-time">{timeAgo((v || row?.createdAt) as string)}</span>
                ),
              },
              {
                key: '_actions',
                label: '',
                width: '50px',
                render: (_: unknown, row: Record<string, unknown>) =>
                  row.status === 'failed' ? (
                    <button
                      type="button"
                      className="ss-dash-btn-retry"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRetry(row.id as string)
                      }}
                    >
                      Retry
                    </button>
                  ) : null,
              },
            ]}
            data={jobs}
            emptyMessage="No jobs found"
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

export default JobsSection
