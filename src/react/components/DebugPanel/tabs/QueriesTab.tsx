import React, { useState, useMemo, useCallback } from 'react'

import { formatTime, formatDuration } from '../../../../core/formatters.js'
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

  // Detect duplicates (same SQL appearing 3+ times)
  const dupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const q of data?.queries || []) {
      counts[q.sql] = (counts[q.sql] || 0) + 1
    }
    return counts
  }, [data])

  const toggleExpand = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

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
        <span className="ss-dbg-summary">{queries.length} queries</span>
      </div>

      {queries.length === 0 ? (
        <div className="ss-dbg-empty">No queries captured</div>
      ) : (
        <table className="ss-dbg-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th>SQL</th>
              <th style={{ width: '70px' }}>Duration</th>
              <th style={{ width: '60px' }}>Method</th>
              <th style={{ width: '90px' }}>Model</th>
              <th style={{ width: '80px' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {queries.map((q) => (
              <tr key={q.id}>
                <td>{q.id}</td>
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
                  {dupCounts[q.sql] >= 3 && (
                    <span className="ss-dbg-dup"> x{dupCounts[q.sql]}</span>
                  )}
                  {q.inTransaction && <span className="ss-dbg-dup"> TXN</span>}
                </td>
                <td>
                  <span
                    className={`ss-dbg-duration ${q.duration > 500 ? 'ss-dbg-very-slow' : q.duration > 100 ? 'ss-dbg-slow' : ''}`}
                  >
                    {formatDuration(q.duration)}
                  </span>
                </td>
                <td>
                  <span className={`ss-dbg-method ss-dbg-method-${q.method.toLowerCase()}`}>
                    {q.method}
                  </span>
                </td>
                <td style={{ color: 'var(--ss-text-secondary)' }}>{q.model || '-'}</td>
                <td style={{ color: 'var(--ss-dim)', fontSize: '10px' }}>
                  {formatTime(q.timestamp)}
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
