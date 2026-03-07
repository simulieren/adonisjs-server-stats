import React, { useState, useMemo, useCallback } from 'react'

import { formatTime, timeAgo } from '../../../../core/formatters.js'
import {
  LOG_LEVELS,
  resolveLogLevel,
  resolveLogMessage,
  resolveLogTimestamp,
  resolveLogRequestId,
  getLogLevelCssClass,
  filterLogsByLevel,
} from '../../../../core/log-utils.js'
import { useDebugData } from '../../../hooks/useDebugData.js'

import type { LogEntry } from '../../../../core/log-utils.js'
import type { DebugPanelProps } from '../../../../core/types.js'

interface LogsTabProps {
  options?: DebugPanelProps
}

export function LogsTab({ options }: LogsTabProps) {
  const { data, isLoading, error } = useDebugData<
    LogEntry[] | { logs?: LogEntry[]; entries?: LogEntry[] }
  >('logs', options)
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [reqIdFilter, setReqIdFilter] = useState('')

  const logs = useMemo(() => {
    let items: LogEntry[] = Array.isArray(data) ? data : data?.logs || data?.entries || []
    items = filterLogsByLevel(items, levelFilter)
    if (reqIdFilter) {
      const f = reqIdFilter.toLowerCase()
      items = items.filter((l) => {
        const rid = resolveLogRequestId(l).toLowerCase()
        return rid.includes(f)
      })
    }
    if (search) {
      const s = search.toLowerCase()
      items = items.filter((l) => resolveLogMessage(l).toLowerCase().includes(s))
    }
    return items
  }, [data, levelFilter, search, reqIdFilter])

  const handleReqIdClick = useCallback((reqId: string) => {
    setReqIdFilter((prev) => (prev === reqId ? '' : reqId))
  }, [])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading logs...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  return (
    <div>
      {/* Level filter buttons */}
      <div className="ss-dbg-log-filters">
        {LOG_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`ss-dbg-log-filter ${levelFilter === level ? 'ss-dbg-active' : ''}`}
            onClick={() => setLevelFilter(level)}
          >
            {level}
          </button>
        ))}
        {reqIdFilter && (
          <button
            type="button"
            className="ss-dbg-log-filter ss-dbg-active"
            onClick={() => setReqIdFilter('')}
          >
            req: {reqIdFilter.slice(0, 8)} x
          </button>
        )}
        <span className="ss-dbg-summary" style={{ marginLeft: 'auto' }}>
          {logs.length} entries
        </span>
      </div>

      {/* Search bar */}
      <div className="ss-dbg-search-bar">
        <input
          type="text"
          className="ss-dbg-search"
          placeholder="Filter log messages..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Log entries */}
      <div style={{ overflow: 'auto', flex: 1 }}>
        {logs.length === 0 ? (
          <div className="ss-dbg-empty">No log entries</div>
        ) : (
          logs
            .slice(-200)
            .reverse()
            .map((log, i) => {
              const level = resolveLogLevel(log)
              const msg = resolveLogMessage(log)
              const ts = resolveLogTimestamp(log)
              const reqId = resolveLogRequestId(log)

              return (
                <div key={i} className="ss-dbg-log-entry">
                  <span className={`ss-dbg-log-level ${getLogLevelCssClass(level)}`}>
                    {level.toUpperCase()}
                  </span>
                  <span className="ss-dbg-log-time" title={ts ? formatTime(ts) : ''}>
                    {ts ? timeAgo(ts) : '-'}
                  </span>
                  {reqId ? (
                    <span
                      className="ss-dbg-log-reqid"
                      onClick={() => handleReqIdClick(reqId)}
                      role="button"
                      tabIndex={0}
                      title={reqId}
                      onKeyDown={(e) => e.key === 'Enter' && handleReqIdClick(reqId)}
                    >
                      {reqId.slice(0, 8)}
                    </span>
                  ) : (
                    <span className="ss-dbg-log-reqid-empty">-</span>
                  )}
                  <span className="ss-dbg-log-msg">{msg}</span>
                </div>
              )
            })
        )}
      </div>
    </div>
  )
}

export default LogsTab
