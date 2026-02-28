import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'

import { formatTime, formatDuration, timeAgo } from '../../../../core/formatters.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import { useDebugData } from '../../../hooks/useDebugData.js'

import type { QueryRecord, DebugPanelProps } from '../../../../core/types.js'

interface QueriesTabProps {
  options?: DebugPanelProps
}

export function QueriesTab({ options }: QueriesTabProps) {
  const { data, isLoading, error } = useDebugData<{ queries: QueryRecord[] }>('queries', options)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const queries = useMemo(() => {
    const items = data?.queries || []
    if (!search) return items
    const lower = search.toLowerCase()
    return items.filter(
      (q) =>
        q.sql.toLowerCase().includes(lower) ||
        (q.model && q.model.toLowerCase().includes(lower)) ||
        q.method.toLowerCase().includes(lower)
    )
  }, [data, search])

  // Detect duplicates (same SQL appearing more than once)
  const dupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const q of data?.queries || []) {
      counts[q.sql] = (counts[q.sql] || 0) + 1
    }
    return counts
  }, [data])

  const summaryStats = useMemo(() => {
    const all = data?.queries || []
    const slowCount = all.filter((q) => q.duration > 100).length
    const dupCount = Object.values(dupCounts).filter((c) => c > 1).length
    const avgDuration = all.length > 0 ? all.reduce((sum, q) => sum + q.duration, 0) / all.length : 0
    return { slowCount, dupCount, avgDuration }
  }, [data, dupCounts])

  const toggleExpand = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const tableRef = useRef<HTMLTableElement>(null)
  useEffect(() => {
    if (tableRef.current) {
      return initResizableColumns(tableRef.current)
    }
  }, [queries])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading queries...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  return (
    <div>
      <div className="ss-dbg-search-bar">
        <input
          type="text"
          className="ss-dbg-search"
          placeholder="Filter queries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ss-dbg-summary">
          {queries.length} queries
          {summaryStats.slowCount > 0 && ` | ${summaryStats.slowCount} slow`}
          {summaryStats.dupCount > 0 && ` | ${summaryStats.dupCount} dup`}
          {queries.length > 0 && ` | avg ${formatDuration(summaryStats.avgDuration)}`}
        </span>
      </div>

      {queries.length === 0 ? (
        <div className="ss-dbg-empty">No queries captured</div>
      ) : (
        <table ref={tableRef} className="ss-dbg-table">
          <colgroup>
            <col style={{ width: '50px' }} />
            <col />
            <col style={{ width: '80px' }} />
            <col style={{ width: '70px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '80px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>SQL</th>
              <th>Duration</th>
              <th>Method</th>
              <th>Model</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {queries.map((q) => (
              <tr key={q.id}>
                <td className="ss-dbg-c-dim" style={{ whiteSpace: 'nowrap' }}>{q.id}</td>
                <td>
                  <span
                    className={`ss-dbg-sql ${expandedId === q.id ? 'ss-dbg-expanded' : ''}`}
                    onClick={() => toggleExpand(q.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && toggleExpand(q.id)}
                  >
                    {q.sql}
                  </span>
                  {dupCounts[q.sql] > 1 && (
                    <span className="ss-dbg-dup"> x{dupCounts[q.sql]}</span>
                  )}
                  {q.inTransaction && <span className="ss-dbg-dup"> TXN</span>}
                </td>
                <td
                  className={`ss-dbg-duration ${q.duration > 500 ? 'ss-dbg-very-slow' : q.duration > 100 ? 'ss-dbg-slow' : ''}`}
                >
                  {formatDuration(q.duration)}
                </td>
                <td>
                  <span className={`ss-dbg-method ss-dbg-method-${q.method.toLowerCase()}`}>
                    {q.method}
                  </span>
                </td>
                <td className="ss-dbg-c-muted">{q.model || '-'}</td>
                <td className="ss-dbg-event-time" title={formatTime(q.timestamp)}>
                  {timeAgo(q.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default QueriesTab
