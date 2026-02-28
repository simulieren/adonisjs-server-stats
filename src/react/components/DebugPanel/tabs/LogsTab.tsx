import React, { useState, useMemo, useCallback } from 'react'

import { formatTime, timeAgo } from '../../../../core/formatters.js'
import { useDebugData } from '../../../hooks/useDebugData.js'

import type { DebugPanelProps } from '../../../../core/types.js'

interface LogEntry {
  level: string
  msg: string
  time: number
  requestId?: string
  [key: string]: string | number | boolean | undefined
}

interface LogsTabProps {
  options?: DebugPanelProps
}

const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

export function LogsTab({ options }: LogsTabProps) {
  const { data, isLoading, error } = useDebugData<LogEntry[] | { logs?: LogEntry[]; entries?: LogEntry[] }>('logs', options)
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [reqIdFilter, setReqIdFilter] = useState('')

  /** Resolve the log level from whichever field the backend provides. */
  const resolveLevel = useCallback(
    (l: LogEntry) =>
      (
        (l.levelName as string) ||
        (l.level_name as string) ||
        (typeof l.level === 'string' ? l.level : '') ||
        'info'
      ).toLowerCase(),
    []
  )

  /** Resolve the message from whichever field the backend provides. */
  const resolveMsg = useCallback(
    (l: LogEntry) => (l.msg as string) || (l.message as string) || JSON.stringify(l),
    []
  )

  /** Resolve the timestamp from whichever field the backend provides. */
  const resolveTime = useCallback(
    (l: LogEntry) => (l.time as number) || (l.timestamp as number) || 0,
    []
  )

  /** Resolve the request ID from whichever field the backend provides. */
  const resolveReqId = useCallback(
    (l: LogEntry) =>
      (l.requestId as string) ||
      (l.request_id as string) ||
      (l['x-request-id'] as string) ||
      '',
    []
  )

  const logs = useMemo(() => {
    let items: LogEntry[] = Array.isArray(data)
      ? data
      : (data?.logs || data?.entries || [])
    if (levelFilter !== 'all') {
      items = items.filter((l) => {
        const level = resolveLevel(l)
        if (levelFilter === 'error') return level === 'error' || level === 'fatal'
        return level === levelFilter
      })
    }
    if (reqIdFilter) {
      const f = reqIdFilter.toLowerCase()
      items = items.filter((l) => {
        const rid = resolveReqId(l).toLowerCase()
        return rid.includes(f)
      })
    }
    if (search) {
      const s = search.toLowerCase()
      items = items.filter((l) => resolveMsg(l).toLowerCase().includes(s))
    }
    return items
  }, [data, levelFilter, search, reqIdFilter, resolveLevel, resolveMsg, resolveReqId])

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
          logs.slice(-200).reverse().map((log, i) => {
            const level = resolveLevel(log)
            const msg = resolveMsg(log)
            const ts = resolveTime(log)
            const reqId = resolveReqId(log)

            return (
              <div key={i} className="ss-dbg-log-entry">
                <span className={`ss-dbg-log-level ${levelClass(level)}`}>
                  {level.toUpperCase()}
                </span>
                <span className="ss-dbg-log-time" title={ts ? formatTime(ts) : ''}>{ts ? timeAgo(ts) : '-'}</span>
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
