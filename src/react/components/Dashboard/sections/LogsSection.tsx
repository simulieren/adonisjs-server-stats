import React, { useState, useCallback } from 'react'

import { formatTime, timeAgo } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface LogsSectionProps {
  options?: DashboardHookOptions
}

interface StructuredFilter {
  field: string
  operator: string
  value: string
}

const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

export function LogsSection({ options = {} }: LogsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [reqIdFilter, setReqIdFilter] = useState('')
  const [reqIdInput, setReqIdInput] = useState('')
  const [structuredFilters, setStructuredFilters] = useState<StructuredFilter[]>([])
  const [structuredField, setStructuredField] = useState('level')
  const [structuredOp, setStructuredOp] = useState('equals')
  const [structuredValue, setStructuredValue] = useState('')

  const filters: Record<string, string> = {}
  if (levelFilter !== 'all') filters.level = levelFilter
  if (reqIdFilter) filters.request_id = reqIdFilter
  structuredFilters.forEach((sf, idx) => {
    filters[`filter_field_${idx}`] = sf.field
    filters[`filter_op_${idx}`] = sf.operator
    filters[`filter_value_${idx}`] = sf.value
  })

  const { data, meta, isLoading } = useDashboardData('logs', {
    ...options,
    page,
    search,
    filters,
  })

  const logs = (data as Record<string, unknown>[]) || []

  const handleReqIdClick = useCallback((reqId: string) => {
    setReqIdFilter(reqId)
    setReqIdInput(reqId)
    setPage(1)
  }, [])

  const handleReqIdInputSubmit = useCallback(() => {
    const trimmed = reqIdInput.trim()
    setReqIdFilter(trimmed)
    setPage(1)
  }, [reqIdInput])

  const clearReqIdFilter = useCallback(() => {
    setReqIdFilter('')
    setReqIdInput('')
    setPage(1)
  }, [])

  const clearLevelFilter = useCallback(() => {
    setLevelFilter('all')
    setPage(1)
  }, [])

  const addStructuredFilter = useCallback(() => {
    const trimmed = structuredValue.trim()
    if (!trimmed) return
    setStructuredFilters((prev) => [
      ...prev,
      { field: structuredField, operator: structuredOp, value: trimmed },
    ])
    setStructuredValue('')
  }, [structuredField, structuredOp, structuredValue])

  const removeStructuredFilter = useCallback((index: number) => {
    setStructuredFilters((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const hasActiveFilters =
    levelFilter !== 'all' || reqIdFilter !== '' || structuredFilters.length > 0

  return (
    <div>
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Search logs..." summary={`${meta?.total ?? 0} logs`}>
        <div className="ss-dash-log-filters">
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`ss-dash-log-filter ${levelFilter === level ? 'ss-dash-active' : ''}`}
              onClick={() => {
                setLevelFilter(level)
                setPage(1)
              }}
            >
              {level}
            </button>
          ))}
          <input
            type="text"
            className="ss-dash-filter-input ss-dash-reqid-input"
            placeholder="Filter by request ID..."
            value={reqIdInput}
            onChange={(e) => setReqIdInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleReqIdInputSubmit()}
          />
          {(reqIdInput || reqIdFilter) && (
            <button
              type="button"
              className="ss-dash-btn ss-dash-reqid-clear"
              onClick={() => {
                clearReqIdFilter()
              }}
            >
              Clear
            </button>
          )}
        </div>
      </FilterBar>

      {/* Structured search panel */}
      <div className="ss-dash-structured-search">
        <select
          className="ss-dash-filter-select"
          value={structuredField}
          onChange={(e) => setStructuredField(e.target.value)}
        >
          <option value="level">level</option>
          <option value="message">message</option>
          <option value="request_id">request_id</option>
          <option value="userId">userId</option>
          <option value="email">email</option>
          <option value="path">path</option>
        </select>
        <select
          className="ss-dash-filter-select"
          value={structuredOp}
          onChange={(e) => setStructuredOp(e.target.value)}
        >
          <option value="equals">equals</option>
          <option value="contains">contains</option>
          <option value="starts_with">starts with</option>
        </select>
        <input
          className="ss-dash-filter-input"
          placeholder="Value..."
          value={structuredValue}
          onChange={(e) => setStructuredValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addStructuredFilter()}
        />
        <button type="button" className="ss-dash-btn" onClick={addStructuredFilter}>
          Add
        </button>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="ss-dash-filter-chips">
          {levelFilter !== 'all' && (
            <span className="ss-dash-filter-chip">
              level: {levelFilter}
              <button
                type="button"
                className="ss-dash-filter-chip-remove"
                onClick={clearLevelFilter}
              >
                &times;
              </button>
            </span>
          )}
          {reqIdFilter && (
            <span className="ss-dash-filter-chip">
              requestId: {reqIdFilter.slice(0, 8)}...
              <button
                type="button"
                className="ss-dash-filter-chip-remove"
                onClick={clearReqIdFilter}
              >
                &times;
              </button>
            </span>
          )}
          {structuredFilters.map((sf, idx) => (
            <span key={idx} className="ss-dash-filter-chip">
              {sf.field} {sf.operator} &quot;{sf.value}&quot;
              <button
                type="button"
                className="ss-dash-filter-chip-remove"
                onClick={() => removeStructuredFilter(idx)}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading logs...</div>
      ) : logs.length === 0 ? (
        <div className="ss-dash-empty">
          No log entries
          {reqIdFilter
            ? ` matching request ${reqIdFilter}`
            : levelFilter !== 'all'
              ? ` for ${levelFilter}`
              : ''}
        </div>
      ) : (
        <div className="ss-dash-log-entries">
          {logs.map((log, i) => {
            const level = (
              (log.level as string) ||
              (log.levelName as string) ||
              (log.level_name as string) ||
              'info'
            ).toLowerCase()
            const message = ((log.message as string) || (log.msg as string) || '') as string
            const logData = (log.data || {}) as Record<string, unknown>
            const reqId = (
              (log.requestId as string) ||
              (log.request_id as string) ||
              (log['x-request-id'] as string) ||
              (logData.requestId as string) ||
              (logData.request_id as string) ||
              (logData['x-request-id'] as string) ||
              ''
            ) as string
            const ts = (log.createdAt || log.created_at || log.time || log.timestamp || 0) as
              | string
              | number

            return (
              <div key={(log.id as string) || i} className="ss-dash-log-entry">
                <span className={`ss-dash-log-level ss-dash-log-level-${level}`}>
                  {level.toUpperCase()}
                </span>
                <span className="ss-dash-log-time" title={ts ? formatTime(ts as string) : ''}>{ts ? timeAgo(ts as string) : '-'}</span>
                {reqId ? (
                  <span
                    className="ss-dash-log-reqid"
                    title={reqId}
                    onClick={() => handleReqIdClick(reqId)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleReqIdClick(reqId)}
                  >
                    {reqId.slice(0, 8)}
                  </span>
                ) : (
                  <span className="ss-dash-log-reqid-empty">--</span>
                )}
                <span className="ss-dash-log-msg">{message}</span>
              </div>
            )
          })}
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
