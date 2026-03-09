import React, { useState, useMemo, useCallback } from 'react'

import {
  LOG_LEVELS,
  resolveLogRequestId,
  resolveLogMessage,
  filterLogsByLevel,
} from '../../../../core/log-utils.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { FilterBar } from '../../shared/FilterBar.js'
import { LogEntryRow } from '../../shared/LogEntryRow.js'

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
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

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
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter log messages..."
      />

      {/* Log entries */}
      <div style={{ overflow: 'auto', flex: 1 }}>
        {logs.length === 0 ? (
          <div className="ss-dbg-empty">No log entries</div>
        ) : (
          logs.slice(0, 200).map((log, i) => (
            <LogEntryRow
              key={i}
              log={log}
              index={i}
              expanded={expandedIndex === i}
              onToggleExpand={(idx) => setExpandedIndex(expandedIndex === idx ? null : idx)}
              onReqIdClick={handleReqIdClick}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default LogsTab
