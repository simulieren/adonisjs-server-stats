import React, { useState, useCallback } from 'react'

import { formatTime } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { Badge } from '../../shared/Badge.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface LogsSectionProps {
  options?: DashboardHookOptions
}

const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

export function LogsSection({ options = {} }: LogsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [reqIdFilter, setReqIdFilter] = useState('')

  const filters: Record<string, string> = {}
  if (levelFilter !== 'all') filters.level = levelFilter
  if (reqIdFilter) filters.requestId = reqIdFilter

  const { data, meta, isLoading } = useDashboardData('logs', {
    ...options,
    page,
    search,
    filters,
  })

  const logs = (data as any[]) || []

  const levelColorMap: Record<string, string> = {
    error: 'red',
    fatal: 'red',
    warn: 'amber',
    info: 'green',
    debug: 'muted',
    trace: 'muted',
  }

  const handleReqIdClick = useCallback((reqId: string) => {
    setReqIdFilter((prev) => (prev === reqId ? '' : reqId))
  }, [])

  return (
    <div>
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Search logs...">
        <div className="ss-dash-level-filters">
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`ss-dash-filter-btn ${levelFilter === level ? 'ss-dash-active' : ''}`}
              onClick={() => {
                setLevelFilter(level)
                setPage(1)
              }}
            >
              {level}
            </button>
          ))}
          {reqIdFilter && (
            <button
              type="button"
              className="ss-dash-filter-btn ss-dash-active"
              onClick={() => setReqIdFilter('')}
            >
              req:{reqIdFilter.slice(0, 8)} x
            </button>
          )}
        </div>
      </FilterBar>

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading logs...</div>
      ) : logs.length === 0 ? (
        <div className="ss-dash-empty">No log entries</div>
      ) : (
        <div className="ss-dash-log-list">
          {logs.map((log: any, i: number) => (
            <div key={log.id || i} className="ss-dash-log-entry">
              <Badge color={(levelColorMap[log.level] || 'muted') as any}>
                {log.level?.toUpperCase()}
              </Badge>
              <span className="ss-dash-log-time">
                {formatTime(log.created_at || log.timestamp)}
              </span>
              {log.request_id ? (
                <span
                  className="ss-dash-log-reqid"
                  onClick={() => handleReqIdClick(log.request_id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleReqIdClick(log.request_id)}
                >
                  {log.request_id.slice(0, 8)}
                </span>
              ) : (
                <span className="ss-dash-log-reqid-empty">--</span>
              )}
              <span className="ss-dash-log-msg">{log.message}</span>
            </div>
          ))}
        </div>
      )}

      {meta && (
        <Pagination
          page={meta.page}
          lastPage={meta.lastPage}
          total={meta.total}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}

export default LogsSection
