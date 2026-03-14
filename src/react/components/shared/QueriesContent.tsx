import React, { useMemo } from 'react'

import { durationClassName } from '../../../core/formatters.js'
import {
  flattenPlanTree,
  hasNestedPlan,
  getExplainColumns,
  formatCellValue,
} from '../../../core/explain-utils.js'
import { resolveNormalizedSql, resolveSqlMethod, resolveTimestamp } from '../../../core/field-resolvers.js'
import {
  getDashboardListColumns,
  getDashboardGroupedColumns,
} from '../../../core/queries-columns.js'
import { buildSqlCounts } from '../../../core/query-utils.js'
import { FilterBar } from './FilterBar.js'
import { TimeAgoCell } from './TimeAgoCell.js'
import { DataTable } from '../Dashboard/shared/DataTable.js'
import { Pagination } from '../Dashboard/shared/Pagination.js'

import type { PlanNode } from '../../../core/explain-utils.js'
import type { QueriesColumnDef } from '../../../core/queries-columns.js'
import type { ExplainEntry, QueriesControllerState } from '../../../core/queries-controller.js'

// ---------------------------------------------------------------------------
//  Explain plan React wrappers (uses core flattenPlanTree)
// ---------------------------------------------------------------------------

function ExplainPlanNode({ node, depth = 0 }: { node: PlanNode; depth?: number }) {
  if (!node) return null

  const flatNodes = useMemo(() => flattenPlanTree(node, depth), [node, depth])

  return (
    <>
      {flatNodes.map((flat, i) => (
        <div key={i} className="ss-dash-explain-node" style={{ marginLeft: `${flat.depth * 20}px` }}>
          <div className="ss-dash-explain-node-header">
            <span className="ss-dash-explain-node-type">{flat.nodeType}</span>
            {flat.relationName && (
              <>
                {' on '}
                <strong>{flat.relationName}</strong>
              </>
            )}
            {flat.alias && ` (${flat.alias})`}
            {flat.indexName && (
              <>
                {' using '}
                <em>{flat.indexName}</em>
              </>
            )}
          </div>
          {flat.metrics.length > 0 && (
            <div className="ss-dash-explain-metrics">{flat.metrics.join(' \u00B7 ')}</div>
          )}
        </div>
      ))}
    </>
  )
}

function ExplainPlanResult({ plan }: { plan: unknown[] }) {
  if (!plan || !Array.isArray(plan) || plan.length === 0) {
    return <div className="ss-dash-explain-result">No plan data returned</div>
  }

  const topPlan = plan[0] as Record<string, unknown>

  if (hasNestedPlan(topPlan)) {
    return (
      <div className="ss-dash-explain-result">
        <ExplainPlanNode node={topPlan['Plan'] as PlanNode} depth={0} />
      </div>
    )
  }

  if (typeof topPlan === 'object' && topPlan !== null) {
    const cols = getExplainColumns(plan as Record<string, unknown>[])
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
                    <td key={c}>{formatCellValue(r[c])}</td>
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

// ---------------------------------------------------------------------------
//  Empty state help text
// ---------------------------------------------------------------------------

const queriesEmptyHelp = (
  <span className="ss-empty-hint">
    Queries require <code>debug: true</code> on your Lucid connections in{' '}
    <code>config/database.ts</code>
  </span>
)

// ---------------------------------------------------------------------------
//  Props
// ---------------------------------------------------------------------------

interface QueriesContentProps {
  /** Rendering mode — determines feature set (explain, pagination, grouped). */
  mode: 'dashboard' | 'debug'

  controllerState: QueriesControllerState

  /** Query rows (untyped dashboard rows or typed QueryRecord[]). */
  queries: Record<string, unknown>[]

  /** Pagination metadata (dashboard only). */
  meta?: { page: number; lastPage: number; total: number } | null

  isLoading?: boolean

  onSearchChange: (search: string) => void
  onSort: (key: string) => void
  onToggleExpand: (id: number | string) => void
  onViewModeChange?: (mode: 'list' | 'grouped') => void
  onPageChange?: (page: number) => void
  onExplain?: (queryId: number) => void
  onCloseExplain?: () => void

  summary: React.ReactNode
  filterBarChildren?: React.ReactNode
}

/**
 * Shared queries rendering component used by both Dashboard QueriesSection
 * and DebugPanel QueriesTab. Both modes render the same UI — same columns,
 * same styles, same DataTable. The only differences: debug mode has no
 * explain, no pagination, and no grouped view.
 */
export function QueriesContent({
  mode,
  controllerState,
  queries,
  meta,
  isLoading,
  onSearchChange,
  onSort,
  onToggleExpand,
  onViewModeChange,
  onPageChange,
  onExplain,
  onCloseExplain,
  summary,
  filterBarChildren,
}: QueriesContentProps) {
  const { viewMode, sort, expandedIds, explainData, search } = controllerState

  const hasExplain = !!onExplain
  const hasPagination = mode === 'dashboard' && !!meta
  const hasGrouped = mode === 'dashboard' && !!onViewModeChange

  const sqlCounts = useMemo(() => buildSqlCounts(queries), [queries])

  // Grouped view (dashboard only)
  if (hasGrouped && viewMode === 'grouped') {
    return renderGrouped()
  }

  // List view (both modes — identical UI)
  return renderList()

  // -----------------------------------------------------------------------
  //  Grouped view
  // -----------------------------------------------------------------------

  function renderGrouped() {
    const groupedColDefs = getDashboardGroupedColumns()
    const groupedColumns = groupedColDefs.map((def) =>
      mapGroupedColumnDef(def, expandedIds, onToggleExpand)
    )

    return (
      <div>
        <FilterBar search={search} onSearchChange={onSearchChange} placeholder="Filter queries..." summary={summary}>
          {filterBarChildren}
        </FilterBar>

        {isLoading && queries.length === 0 ? (
          <div className="ss-dash-empty">Loading queries...</div>
        ) : (
          <div className="ss-dash-table-wrap">
            <DataTable
              columns={groupedColumns}
              data={queries}
              keyField="sqlNormalized"
              sort={sort.key}
              sortDir={sort.dir}
              onSort={onSort}
              emptyMessage={<>No queries recorded{queriesEmptyHelp}</>}
            />
          </div>
        )}
      </div>
    )
  }

  // -----------------------------------------------------------------------
  //  List view (same for dashboard and debug)
  // -----------------------------------------------------------------------

  function renderList() {
    const listColDefs = getDashboardListColumns({ showExplain: hasExplain })
    const listColumns = listColDefs.map((def) =>
      mapListColumnDef(def, expandedIds, sqlCounts, explainData, onToggleExpand, onExplain)
    )
    const colCount = listColDefs.length

    const renderExplainRow = hasExplain
      ? (row: Record<string, unknown>) => {
          const rowId = row.id as number
          const entry = explainData.get(rowId)
          if (!entry || entry.loading) return null

          return (
            <tr className="ss-dash-explain-row">
              <td colSpan={colCount} className="ss-dash-explain">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ flex: 1 }}>
                    {entry.error ? (
                      <div className="ss-dash-explain-result ss-dash-explain-error">
                        <strong>Error:</strong> {entry.error}
                        {entry.result?.message && (
                          <>
                            <br />
                            {entry.result.message}
                          </>
                        )}
                      </div>
                    ) : entry.result ? (
                      <ExplainPlanResult plan={(entry.result.plan || entry.result.rows || []) as unknown[]} />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="ss-dash-explain-btn"
                    onClick={() => onCloseExplain?.()}
                    style={{ marginLeft: '8px', flexShrink: 0 }}
                  >
                    Close
                  </button>
                </div>
              </td>
            </tr>
          )
        }
      : undefined

    return (
      <div>
        <FilterBar search={search} onSearchChange={onSearchChange} placeholder="Filter queries..." summary={summary}>
          {filterBarChildren}
        </FilterBar>

        {isLoading && queries.length === 0 ? (
          <div className="ss-dash-empty">Loading queries...</div>
        ) : (
          <>
            <div className="ss-dash-table-wrap">
              <DataTable
                columns={listColumns}
                data={queries}
                sort={sort.key}
                sortDir={sort.dir}
                onSort={onSort}
                emptyMessage={<>No queries captured{queriesEmptyHelp}</>}
                renderAfterRow={renderExplainRow}
              />
            </div>
            {hasPagination && meta && (
              <Pagination
                page={meta.page}
                lastPage={meta.lastPage}
                total={meta.total}
                onPageChange={onPageChange!}
              />
            )}
          </>
        )}
      </div>
    )
  }
}

// ---------------------------------------------------------------------------
//  Column mapping helpers
// ---------------------------------------------------------------------------

type DataTableColumn = {
  key: string
  label: string
  width?: string
  sortable?: boolean
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode
}

function mapGroupedColumnDef(
  def: QueriesColumnDef,
  expandedIds: Set<number | string>,
  onToggleExpand: (id: number | string) => void
): DataTableColumn {
  const col: DataTableColumn = {
    key: def.key,
    label: def.label,
    width: def.width,
    sortable: def.sortable,
  }

  switch (def.type) {
    case 'sql':
      col.render = (v: unknown, row: Record<string, unknown>) => {
        const sqlText = (v as string) || ''
        const isDup = ((row.count as number) || 0) >= 3
        return (
          <>
            <span
              className={`ss-dash-sql ${expandedIds.has(sqlText) ? 'ss-dash-expanded' : ''}`}
              title="Click to expand"
              onClick={(e) => { e.stopPropagation(); onToggleExpand(sqlText) }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onToggleExpand(sqlText)}
            >
              {sqlText}
            </span>
            {isDup && <> <span className="ss-dash-dup">DUP</span></>}
          </>
        )
      }
      break

    case 'duration':
      col.render = (v: unknown) => {
        const dur = (v as number) || 0
        const useSeverity = def.key === 'avgDuration' || def.key === 'maxDuration'
        return (
          <span className={`ss-dash-duration ${useSeverity ? durationClassName(dur) : ''}`}>
            {def.key === 'totalDuration' ? dur.toFixed(1) + 'ms' : dur.toFixed(2) + 'ms'}
          </span>
        )
      }
      break

    default:
      if (def.key === 'count') {
        col.render = (v: unknown) => (
          <span style={{ color: 'var(--ss-muted)', textAlign: 'center', display: 'block' }}>
            {(v as number) || 0}
          </span>
        )
      } else if (def.key === 'percentOfTotal') {
        col.render = (v: unknown) => (
          <span style={{ color: 'var(--ss-muted)', textAlign: 'center', display: 'block' }}>
            {((v as number) || 0).toFixed(1) + '%'}
          </span>
        )
      }
      break
  }

  return col
}

function mapListColumnDef(
  def: QueriesColumnDef,
  expandedIds: Set<number | string>,
  sqlCounts: Map<string, number>,
  explainData: Map<number, ExplainEntry>,
  onToggleExpand: (id: number | string) => void,
  onExplain?: (queryId: number) => void
): DataTableColumn {
  const col: DataTableColumn = {
    key: def.key,
    label: def.label,
    width: def.width,
    sortable: def.sortable,
  }

  switch (def.type) {
    case 'index':
      col.render = (v) => (
        <span style={{ color: 'var(--ss-dim)' }}>{v as React.ReactNode}</span>
      )
      break

    case 'sql':
      col.render = (_v: unknown, row: Record<string, unknown>) => {
        const sqlText = (row.sql as string) || (row.sql_text as string) || ''
        const rowId = row.id as number
        return (
          <div>
            <span
              className={`ss-dash-sql ${expandedIds.has(rowId) ? 'ss-dash-expanded' : ''}`}
              title="Click to expand"
              onClick={(e) => { e.stopPropagation(); onToggleExpand(rowId) }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onToggleExpand(rowId)}
            >
              {sqlText}
            </span>
            {(sqlCounts.get(resolveNormalizedSql(row)) ?? 0) > 1 && (
              <span className="ss-dash-dup">
                &times;{sqlCounts.get(resolveNormalizedSql(row))}
              </span>
            )}
          </div>
        )
      }
      break

    case 'duration':
      col.render = (v: unknown) => {
        const dur = (v as number) || 0
        return (
          <span className={`ss-dash-duration ${durationClassName(dur)}`}>
            {dur.toFixed(2) + 'ms'}
          </span>
        )
      }
      break

    case 'method':
      col.render = (_v: unknown, row: Record<string, unknown>) => {
        const method = resolveSqlMethod(row)
        return (
          <span className={`ss-dash-method ss-dash-method-${method.toLowerCase()}`}>
            {method}
          </span>
        )
      }
      break

    case 'model':
      col.render = (v: unknown) => (
        <span
          style={{ color: 'var(--ss-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={v as string}
        >
          {(v as string) || '-'}
        </span>
      )
      break

    case 'connection':
      col.render = (v: unknown) => (
        <span style={{ color: 'var(--ss-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(v as string) || '-'}
        </span>
      )
      break

    case 'time':
      col.render = (v: unknown, row: Record<string, unknown>) => {
        const ts = ((v as string) || (resolveTimestamp(row) ?? '')) as string
        return <TimeAgoCell ts={ts} className="ss-dash-event-time" />
      }
      break

    case 'explain':
      col.render = (_v: unknown, row: Record<string, unknown>) => {
        const method = resolveSqlMethod(row)
        if (method !== 'select') return null
        const rowId = row.id as number
        const entry = explainData.get(rowId)
        const isActive = entry && !entry.loading && entry.result && !entry.error
        const loading = entry?.loading
        return (
          <button
            type="button"
            className={`ss-dash-explain-btn${isActive ? ' ss-dash-explain-btn-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onExplain?.(rowId) }}
            disabled={!!loading}
          >
            {loading ? '...' : 'EXPLAIN'}
          </button>
        )
      }
      break
  }

  return col
}

export default QueriesContent
