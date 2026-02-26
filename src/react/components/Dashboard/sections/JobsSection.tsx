import React, { useState, useCallback } from 'react'
import type { DashboardHookOptions } from '../../../../core/types.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { timeAgo, formatDuration } from '../../../../core/formatters.js'
import { DataTable } from '../shared/DataTable.js'
import { Pagination } from '../shared/Pagination.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Badge } from '../../shared/Badge.js'
import { JsonViewer } from '../../shared/JsonViewer.js'

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
  const stats = jobsData?.stats

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
        <div className="ss-dash-stats-row">
          {Object.entries(stats).map(([key, val]) => (
            <div key={key} className="ss-dash-stat-card">
              <span className="ss-dash-stat-label">{key}</span>
              <span className="ss-dash-stat-value">{val as number}</span>
            </div>
          ))}
        </div>
      )}

      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter jobs...">
        <div className="ss-dash-level-filters">
          {JOB_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`ss-dash-filter-btn ${statusFilter === status ? 'ss-dash-active' : ''}`}
              onClick={() => { setStatusFilter(status); setPage(1) }}
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
              { key: 'id', label: 'ID', width: '60px' },
              { key: 'name', label: 'Name', render: (v: string) => <span style={{ color: 'var(--ss-text)' }}>{v}</span> },
              { key: 'status', label: 'Status', width: '80px', render: (v: string) => <Badge color={(statusColor[v] || 'muted') as any}>{v}</Badge> },
              { key: 'data', label: 'Payload', render: (v: any) => <JsonViewer data={v} maxPreviewLength={60} /> },
              { key: 'attempts', label: 'Tries', width: '50px' },
              { key: 'duration', label: 'Duration', width: '70px', render: (v: number | null) => v != null ? formatDuration(v) : '-' },
              { key: 'timestamp', label: 'Time', width: '80px', render: (v: any) => <span className="ss-dash-event-time">{timeAgo(v)}</span> },
              {
                key: '_actions',
                label: '',
                width: '60px',
                render: (_: any, row: any) =>
                  row.status === 'failed' ? (
                    <button
                      type="button"
                      className="ss-dash-btn-retry"
                      onClick={(e) => { e.stopPropagation(); handleRetry(row.id) }}
                    >
                      Retry
                    </button>
                  ) : null,
              },
            ]}
            data={jobs}
            emptyMessage="No jobs found"
          />
          {meta && <Pagination page={meta.page} lastPage={meta.lastPage} total={meta.total} onPageChange={setPage} />}
        </>
      )}
    </div>
  )
}

export default JobsSection
