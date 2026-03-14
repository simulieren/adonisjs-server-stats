import React, { useState, useMemo, useCallback } from 'react'

import {
  formatDuration,
  durationClassName,
} from '../../../../core/formatters.js'
import { TimeAgoCell } from '../../shared/TimeAgoCell.js'
import {
  filterQueries,
  countDuplicateQueries,
  computeQuerySummary,
} from '../../../../core/query-utils.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { useResizableTable } from '../../../hooks/useResizableTable.js'
import { MethodBadge } from '../../shared/Badge.js'
import { FilterBar } from '../../shared/FilterBar.js'

import type { QueryRecord, DebugPanelProps } from '../../../../core/types.js'

interface QueriesTabProps {
  options?: DebugPanelProps
}

export function QueriesTab({ options }: QueriesTabProps) {
  const { data, isLoading, error } = useDebugData<{ queries: QueryRecord[] }>('queries', options)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const allQueries = useMemo(() => data?.queries || [], [data])
  const queries = useMemo(() => filterQueries(allQueries, search), [allQueries, search])
  const dupCounts = useMemo(() => countDuplicateQueries(allQueries), [allQueries])
  const summaryStats = useMemo(
    () => computeQuerySummary(allQueries, dupCounts),
    [allQueries, dupCounts]
  )

  const toggleExpand = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const tableRef = useResizableTable([queries])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading queries...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  return (
    <div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter queries..."
        summary={
          <>
            {queries.length} queries
            {summaryStats.slowCount > 0 && ` | ${summaryStats.slowCount} slow`}
            {summaryStats.dupCount > 0 && ` | ${summaryStats.dupCount} dup`}
            {queries.length > 0 && ` | avg ${formatDuration(summaryStats.avgDuration)}`}
          </>
        }
      />

      {queries.length === 0 ? (
        <div className="ss-dbg-empty">
          <span>No queries captured</span>
          <span className="ss-empty-hint">
            Queries require <code>debug: true</code> on your Lucid connections in{' '}
            <code>config/database.ts</code>
          </span>
        </div>
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
                <td className="ss-dbg-c-dim" style={{ whiteSpace: 'nowrap' }}>
                  {q.id}
                </td>
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
                  {dupCounts[q.sql] > 1 && <span className="ss-dbg-dup"> x{dupCounts[q.sql]}</span>}
                  {q.inTransaction && <span className="ss-dbg-dup"> TXN</span>}
                </td>
                <td
                  className={`ss-dbg-duration ${durationClassName(q.duration, 'ss-dbg')}`}
                >
                  {formatDuration(q.duration)}
                </td>
                <td>
                  <MethodBadge method={q.method} classPrefix="ss-dbg" />
                </td>
                <td className="ss-dbg-c-muted">{q.model || '-'}</td>
                <td>
                  <TimeAgoCell ts={q.timestamp} className="ss-dbg-event-time" />
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
