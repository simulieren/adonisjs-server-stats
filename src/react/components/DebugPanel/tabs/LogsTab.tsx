import React, { useState, useMemo, useCallback } from 'react'
import type { DebugPanelProps } from '../../../../core/types.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { formatTime } from '../../../../core/formatters.js'

interface LogEntry {
  level: string
  msg: string
  time: number
  requestId?: string
  [key: string]: any
}

interface LogsTabProps {
  options?: DebugPanelProps
}

const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

export function LogsTab({ options }: LogsTabProps) {
  const { data, isLoading, error } = useDebugData<{ logs: LogEntry[] }>('logs', options)
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [reqIdFilter, setReqIdFilter] = useState('')

  const logs = useMemo(() => {
    let items = data?.logs || []
    if (levelFilter !== 'all') {
      items = items.filter((l) => l.level === levelFilter)
    }
    if (reqIdFilter) {
      items = items.filter((l) => l.requestId && l.requestId.includes(reqIdFilter))
    }
    return items
  }, [data, levelFilter, reqIdFilter])

  const levelClass = useCallback((level: string) => {
    switch (level) {
      case 'error':
      case 'fatal':
        return 'ss-dbg-log-level-error'
      case 'warn':
        return 'ss-dbg-log-level-warn'
      case 'info':
        return 'ss-dbg-log-level-info'
      case 'debug':
        return 'ss-dbg-log-level-debug'
      case 'trace':
        return 'ss-dbg-log-level-trace'
      default:
        return 'ss-dbg-log-level-info'
    }
  }, [])

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

      {/* Log entries */}
      <div style={{ overflow: 'auto', flex: 1 }}>
        {logs.length === 0 ? (
          <div className="ss-dbg-empty">No log entries</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="ss-dbg-log-entry">
              <span className={`ss-dbg-log-level ${levelClass(log.level)}`}>
                {log.level.toUpperCase()}
              </span>
              <span className="ss-dbg-log-time">{formatTime(log.time)}</span>
              {log.requestId ? (
                <span
                  className="ss-dbg-log-reqid"
                  onClick={() => handleReqIdClick(log.requestId!)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleReqIdClick(log.requestId!)}
                >
                  {log.requestId.slice(0, 8)}
                </span>
              ) : (
                <span className="ss-dbg-log-reqid-empty">--</span>
              )}
              <span className="ss-dbg-log-msg">{log.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default LogsTab
