import React, { useState, useCallback, useEffect, useMemo } from 'react'

import { SLOW_DURATION_MS } from '../../../../core/constants.js'
import { resolveField, resolveNormalizedSql, resolveSqlMethod, resolveTimestamp } from '../../../../core/field-resolvers.js'
import { durationClassName } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../../shared/FilterBar.js'
import { TimeAgoCell } from '../../shared/TimeAgoCell.js'
import { Pagination } from '../shared/Pagination.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

/* ------------------------------------------------------------------ */
/*  Explain plan rendering (ported from edge/client/dashboard.js)     */
/* ------------------------------------------------------------------ */

interface PlanNode {
  'Node Type'?: string
  'Relation Name'?: string
  Alias?: string
  'Index Name'?: string
  'Startup Cost'?: number | null
  'Total Cost'?: number | null
  'Plan Rows'?: number | null
  'Plan Width'?: number | null
  Filter?: string
  'Index Cond'?: string
  'Hash Cond'?: string
  'Join Type'?: string
  'Sort Key'?: string | string[]
  Plans?: PlanNode[]
  [key: string]: unknown
}

function ExplainPlanNode({ node, depth = 0 }: { node: PlanNode; depth?: number }) {
  if (!node) return null

  const indent = depth * 20
  const nodeType = node['Node Type'] || 'Unknown'
  const relation = node['Relation Name'] ? (
    <>
      {' on '}
      <strong>{node['Relation Name']}</strong>
    </>
  ) : null
  const alias =
    node['Alias'] && node['Alias'] !== node['Relation Name'] ? ` (${node['Alias']})` : ''
  const idx = node['Index Name'] ? (
    <>
      {' using '}
      <em>{node['Index Name']}</em>
    </>
  ) : null

  const metrics: string[] = []
  if (node['Startup Cost'] !== null && node['Startup Cost'] !== undefined)
    metrics.push(`cost=${node['Startup Cost']}..${node['Total Cost']}`)
  if (node['Plan Rows'] !== null && node['Plan Rows'] !== undefined)
    metrics.push(`rows=${node['Plan Rows']}`)
  if (node['Plan Width'] !== null && node['Plan Width'] !== undefined)
    metrics.push(`width=${node['Plan Width']}`)
  if (node['Filter']) metrics.push(`filter: ${node['Filter']}`)
  if (node['Index Cond']) metrics.push(`cond: ${node['Index Cond']}`)
  if (node['Hash Cond']) metrics.push(`hash: ${node['Hash Cond']}`)
  if (node['Join Type']) metrics.push(`join: ${node['Join Type']}`)
  if (node['Sort Key']) {
    const sortKey = Array.isArray(node['Sort Key']) ? node['Sort Key'].join(', ') : node['Sort Key']
    metrics.push(`sort: ${sortKey}`)
  }

  const childPlans = node['Plans'] || []

  return (
    <div className="ss-dash-explain-node" style={{ marginLeft: `${indent}px` }}>
      <div className="ss-dash-explain-node-header">
        <span className="ss-dash-explain-node-type">{nodeType}</span>
        {relation}
        {alias}
        {idx}
      </div>
      {metrics.length > 0 && (
        <div className="ss-dash-explain-metrics">{metrics.join(' \u00B7 ')}</div>
      )}
      {childPlans.map((child, i) => (
        <ExplainPlanNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function ExplainPlanResult({ plan }: { plan: unknown[] }) {
  if (!plan || !Array.isArray(plan) || plan.length === 0) {
    return <div className="ss-dash-explain-result">No plan data returned</div>
  }

  const topPlan = plan[0] as Record<string, unknown>

  // JSON format: array of objects with a "Plan" key
  if (topPlan && topPlan['Plan']) {
    return (
      <div className="ss-dash-explain-result">
        <ExplainPlanNode node={topPlan['Plan'] as PlanNode} depth={0} />
      </div>
    )
  }

  // Fallback: plain rows table (for non-JSON EXPLAIN output)
  if (typeof topPlan === 'object' && topPlan !== null) {
    const cols = Object.keys(topPlan)
    return (
      <div className="ss-dash-explain-result">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.map((row, ri) => {
              const r = row as Record<string, unknown>
              return (
                <tr key={ri}>
                  {cols.map((c) => (
                    <td key={c}>{r[c] !== null && r[c] !== undefined ? String(r[c]) : '-'}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return <div className="ss-dash-explain-result">No plan data returned</div>
}

/* ------------------------------------------------------------------ */
/*  ExplainData state shape                                           */
/* ------------------------------------------------------------------ */

interface ExplainData {
  queryId: number
  plan: unknown[]
  error?: string
  message?: string
}

/* ------------------------------------------------------------------ */
/*  QueriesSection component                                          */
/* ------------------------------------------------------------------ */

interface QueriesSectionProps {
  options?: DashboardHookOptions
}

/** Number of columns in the list-view query table. */
const LIST_COL_COUNT = 8

export function QueriesSection({ options = {} }: QueriesSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list')
  const [expandedSql, setExpandedSql] = useState<string | number | null>(null)
  const [explainData, setExplainData] = useState<ExplainData | null>(null)
  const [explainLoading, setExplainLoading] = useState<number | null>(null)

  const handleViewModeChange = useCallback(
    (mode: 'list' | 'grouped') => {
      if (mode === viewMode) return
      setViewMode(mode)
      setPage(1)
      setSort(mode === 'list' ? 'createdAt' : 'count')
      setSortDir('desc')
      setExpandedSql(null)
      setExplainData(null)
      setExplainLoading(null)
    },
    [viewMode]
  )

  useEffect(() => setPage(1), [search])

  const endpoint = viewMode === 'grouped' ? 'queries/grouped' : 'queries'
  const { data, meta, isLoading, mutate } = useDashboardData(endpoint, {
    ...options,
    page,
    search,
    sort,
    sortDir,
  })

  const handleSort = useCallback(
    (key: string) => {
      if (sort === key) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      } else {
        setSort(key)
        setSortDir('desc')
      }
    },
    [sort]
  )

  const handleExplain = useCallback(
    async (queryId: number) => {
      // Toggle: if already showing for this query, close it
      if (explainData && explainData.queryId === queryId) {
        setExplainData(null)
        return
      }

      setExplainLoading(queryId)
      try {
        const result = (await mutate(`queries/${queryId}/explain`)) as {
          plan?: unknown[]
          rows?: unknown[]
          error?: string
          message?: string
        }

        if (result && result.error) {
          setExplainData({
            queryId,
            plan: [],
            error: result.error,
            message: result.message,
          })
        } else {
          setExplainData({
            queryId,
            plan: (result?.plan || result?.rows || []) as unknown[],
          })
        }
      } catch (err) {
        console.warn('[ss] Query explain failed:', err)
        setExplainData({
          queryId,
          plan: [],
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        setExplainLoading(null)
      }
    },
    [mutate, explainData]
  )

  const renderExplainRow = useCallback(
    (row: Record<string, unknown>) => {
      const rowId = row.id as number
      if (!explainData || explainData.queryId !== rowId) return null

      return (
        <tr className="ss-dash-explain-row">
          <td colSpan={LIST_COL_COUNT} className="ss-dash-explain">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                {explainData.error ? (
                  <div className="ss-dash-explain-result ss-dash-explain-error">
                    <strong>Error:</strong> {explainData.error}
                    {explainData.message && (
                      <>
                        <br />
                        {explainData.message}
                      </>
                    )}
                  </div>
                ) : (
                  <ExplainPlanResult plan={explainData.plan} />
                )}
              </div>
              <button
                type="button"
                className="ss-dash-explain-btn"
                onClick={() => setExplainData(null)}
                style={{ marginLeft: '8px', flexShrink: 0 }}
              >
                Close
              </button>
            </div>
          </td>
        </tr>
      )
    },
    [explainData]
  )

  const rawQueries =
    viewMode === 'grouped'
      ? (data as { groups?: Record<string, unknown>[] })?.groups || []
      : (data as Record<string, unknown>[]) || []

  /**
   * Normalize grouped query fields so DataTable column keys resolve correctly.
   *
   * The API may return either camelCase (from AdonisJS controller) or
   * snake_case (from raw DB queries). Map both to the camelCase keys that
   * our column definitions expect.
   */
  const queries = useMemo(() => {
    if (viewMode !== 'grouped') return rawQueries

    return rawQueries.map((g) => {
      const normalized = { ...g }

      // Pattern / SQL text
      normalized.sqlNormalized ??= resolveField<string>(g, 'sql_normalized', 'pattern') ?? undefined

      // Numeric aggregation fields
      normalized.count ??= resolveField<number>(g, 'total_count')
      normalized.avgDuration ??= resolveField<number>(g, 'avg_duration')
      normalized.maxDuration ??= resolveField<number>(g, 'max_duration')
      normalized.minDuration ??= resolveField<number>(g, 'min_duration')
      normalized.totalDuration ??= resolveField<number>(g, 'total_duration')

      // Percent of total time: API may return percentOfTotal or pct_time
      normalized.percentOfTotal ??= resolveField<number>(g, 'pct_time')

      return normalized
    })
  }, [rawQueries, viewMode])

  const summary = useMemo(() => {
    const total = meta?.total ?? queries.length
    let slow = 0
    let duplicates = 0
    let totalDur = 0
    let count = 0
    for (const q of queries) {
      const dur = (q.duration as number) || 0
      totalDur += dur
      count++
      if (dur > SLOW_DURATION_MS) slow++
    }
    // Count duplicates from sqlCounts
    const counts = new Map<string, number>()
    for (const q of queries) {
      const sql = resolveNormalizedSql(q)
      counts.set(sql, (counts.get(sql) || 0) + 1)
    }
    for (const c of counts.values()) {
      if (c > 1) duplicates += c
    }
    return {
      total,
      slow,
      duplicates,
      avgDuration: count > 0 ? totalDur / count : 0,
    }
  }, [queries, meta])

  const sqlCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const q of queries) {
      const sql = resolveNormalizedSql(q)
      counts.set(sql, (counts.get(sql) || 0) + 1)
    }
    return counts
  }, [queries])

  const queriesSummaryText = useMemo(() => {
    if (viewMode === 'grouped') {
      return `${queries.length} query patterns`
    }
    const parts = [`${summary.total} queries`]
    if (summary.slow > 0) parts.push(`${summary.slow} slow`)
    if (summary.duplicates > 0) parts.push(`${summary.duplicates} dup`)
    parts.push(`avg ${(summary.avgDuration || 0).toFixed(1)}ms`)
    return parts.join(', ')
  }, [viewMode, queries.length, summary])

  return (
    <div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter queries..."
        summary={queriesSummaryText}
      >
        <div className="ss-dash-btn-group">
          <button
            type="button"
            className={`ss-dash-btn ${viewMode === 'list' ? 'ss-dash-active' : ''}`}
            onClick={() => handleViewModeChange('list')}
          >
            List
          </button>
          <button
            type="button"
            className={`ss-dash-btn ${viewMode === 'grouped' ? 'ss-dash-active' : ''}`}
            onClick={() => handleViewModeChange('grouped')}
          >
            Grouped
          </button>
        </div>
      </FilterBar>

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading queries...</div>
      ) : viewMode === 'grouped' ? (
        <>
          <div className="ss-dash-table-wrap">
            <DataTable
              columns={[
                {
                  key: 'sqlNormalized',
                  label: 'Pattern',
                  render: (v: unknown, row: Record<string, unknown>) => {
                    const sqlText = (v as string) || ''
                    const isDup = ((row.count as number) || 0) >= 3
                    return (
                      <>
                        <span
                          className={`ss-dash-sql ${expandedSql === sqlText ? 'ss-dash-expanded' : ''}`}
                          title="Click to expand"
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedSql(expandedSql === sqlText ? null : sqlText)
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) =>
                            e.key === 'Enter' &&
                            setExpandedSql(expandedSql === sqlText ? null : sqlText)
                          }
                        >
                          {sqlText}
                        </span>
                        {isDup && (
                          <>
                            {' '}
                            <span className="ss-dash-dup">DUP</span>
                          </>
                        )}
                      </>
                    )
                  },
                },
                {
                  key: 'count',
                  label: 'Count',
                  width: '60px',
                  sortable: true,
                  render: (v: unknown) => (
                    <span
                      style={{ color: 'var(--ss-muted)', textAlign: 'center', display: 'block' }}
                    >
                      {(v as number) || 0}
                    </span>
                  ),
                },
                {
                  key: 'avgDuration',
                  label: 'Avg',
                  width: '70px',
                  sortable: true,
                  render: (v: unknown) => {
                    const dur = (v as number) || 0
                    return (
                      <span
                        className={`ss-dash-duration ${durationClassName(dur)}`}
                      >
                        {dur.toFixed(2) + 'ms'}
                      </span>
                    )
                  },
                },
                {
                  key: 'minDuration',
                  label: 'Min',
                  width: '70px',
                  render: (v: unknown) => (
                    <span className="ss-dash-duration">
                      {((v as number) || 0).toFixed(2) + 'ms'}
                    </span>
                  ),
                },
                {
                  key: 'maxDuration',
                  label: 'Max',
                  width: '70px',
                  render: (v: unknown) => {
                    const dur = (v as number) || 0
                    return (
                      <span
                        className={`ss-dash-duration ${durationClassName(dur)}`}
                      >
                        {dur.toFixed(2) + 'ms'}
                      </span>
                    )
                  },
                },
                {
                  key: 'totalDuration',
                  label: 'Total',
                  width: '70px',
                  sortable: true,
                  render: (v: unknown) => (
                    <span className="ss-dash-duration">
                      {((v as number) || 0).toFixed(1) + 'ms'}
                    </span>
                  ),
                },
                {
                  key: 'percentOfTotal',
                  label: '% Time',
                  width: '60px',
                  render: (v: unknown) => (
                    <span
                      style={{ color: 'var(--ss-muted)', textAlign: 'center', display: 'block' }}
                    >
                      {((v as number) || 0).toFixed(1) + '%'}
                    </span>
                  ),
                },
              ]}
              data={queries}
              keyField="sqlNormalized"
              sort={sort}
              sortDir={sortDir}
              onSort={handleSort}
              emptyMessage="No queries recorded"
            />
          </div>
        </>
      ) : (
        <>
          <div className="ss-dash-table-wrap">
            <DataTable
              columns={[
                {
                  key: 'id',
                  label: '#',
                  width: '40px',
                  render: (v) => (
                    <span style={{ color: 'var(--ss-dim)' }}>{v as React.ReactNode}</span>
                  ),
                },
                {
                  key: 'sql',
                  label: 'SQL',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const sqlText = (row.sql as string) || (row.sql_text as string) || ''
                    return (
                      <div>
                        <span
                          className={`ss-dash-sql ${expandedSql === (row.id as number) ? 'ss-dash-expanded' : ''}`}
                          title="Click to expand"
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedSql(
                              expandedSql === (row.id as number) ? null : (row.id as number)
                            )
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) =>
                            e.key === 'Enter' &&
                            setExpandedSql(
                              expandedSql === (row.id as number) ? null : (row.id as number)
                            )
                          }
                        >
                          {sqlText}
                        </span>
                        {(sqlCounts.get(resolveNormalizedSql(row)) ?? 0) > 1 && (
                          <span className="ss-dash-dup">
                            &times;
                            {sqlCounts.get(resolveNormalizedSql(row))}
                          </span>
                        )}
                      </div>
                    )
                  },
                },
                {
                  key: 'duration',
                  label: 'Duration',
                  width: '70px',
                  sortable: true,
                  render: (v: unknown) => {
                    const dur = (v as number) || 0
                    return (
                      <span
                        className={`ss-dash-duration ${durationClassName(dur)}`}
                      >
                        {dur.toFixed(2) + 'ms'}
                      </span>
                    )
                  },
                },
                {
                  key: 'method',
                  label: 'Method',
                  width: '60px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const method = resolveSqlMethod(row)
                    return (
                      <span className={`ss-dash-method ss-dash-method-${method.toLowerCase()}`}>
                        {method}
                      </span>
                    )
                  },
                },
                {
                  key: 'model',
                  label: 'Model',
                  width: '90px',
                  render: (v: unknown) => (
                    <span
                      style={{
                        color: 'var(--ss-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={v as string}
                    >
                      {(v as string) || '-'}
                    </span>
                  ),
                },
                {
                  key: 'connection',
                  label: 'Connection',
                  width: '80px',
                  render: (v: unknown) => (
                    <span
                      style={{
                        color: 'var(--ss-dim)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {(v as string) || '-'}
                    </span>
                  ),
                },
                {
                  key: 'createdAt',
                  label: 'Time',
                  width: '90px',
                  sortable: true,
                  render: (v: unknown, row: Record<string, unknown>) => {
                    const ts = ((v as string) || (resolveTimestamp(row) ?? '')) as string
                    return <TimeAgoCell ts={ts} className="ss-dash-event-time" />
                  },
                },
                {
                  key: 'id',
                  label: '',
                  width: '70px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const method = resolveSqlMethod(row)
                    if (method !== 'select') return null
                    const isActive =
                      explainData?.queryId === (row.id as number) && !explainData?.error
                    return (
                      <button
                        type="button"
                        className={`ss-dash-explain-btn${isActive ? ' ss-dash-explain-btn-active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleExplain(row.id as number)
                        }}
                        disabled={explainLoading === (row.id as number)}
                      >
                        {explainLoading === (row.id as number) ? '...' : 'EXPLAIN'}
                      </button>
                    )
                  },
                },
              ]}
              data={queries}
              sort={sort}
              sortDir={sortDir}
              onSort={handleSort}
              emptyMessage="No queries recorded"
              renderAfterRow={renderExplainRow}
            />
          </div>
          {meta && (
            <Pagination
              page={meta.page}
              lastPage={meta.lastPage}
              total={meta.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}

export default QueriesSection
