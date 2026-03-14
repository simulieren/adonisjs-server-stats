import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'

import { resolveField } from '../../../../core/field-resolvers.js'
import { computeDashboardQuerySummary } from '../../../../core/query-utils.js'
import { QueriesController } from '../../../../core/queries-controller.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { QueriesContent } from '../../shared/QueriesContent.js'

import type { ExplainResult } from '../../../../core/queries-controller.js'
import type { DashboardHookOptions } from '../../../../core/types.js'

/* ------------------------------------------------------------------ */
/*  QueriesSection component                                          */
/* ------------------------------------------------------------------ */

interface QueriesSectionProps {
  options?: DashboardHookOptions
}

export function QueriesSection({ options = {} }: QueriesSectionProps) {
  const [page, setPage] = useState(1)

  // Use QueriesController for all view/sort/expand/explain state
  const controllerRef = useRef(new QueriesController('list'))
  const [controllerState, setControllerState] = useState(controllerRef.current.state)

  // Helper to trigger re-render after controller mutations
  const sync = useCallback(() => {
    setControllerState({ ...controllerRef.current.state })
  }, [])

  const { viewMode, sort, search } = controllerState

  const handleViewModeChange = useCallback(
    (mode: 'list' | 'grouped') => {
      if (mode === controllerRef.current.state.viewMode) return
      controllerRef.current.setViewMode(mode)
      setPage(1)
      sync()
    },
    [sync]
  )

  const handleSearchChange = useCallback(
    (value: string) => {
      controllerRef.current.setSearch(value)
      sync()
    },
    [sync]
  )

  useEffect(() => setPage(1), [search])

  const endpoint = viewMode === 'grouped' ? 'queries/grouped' : 'queries'
  const { data, meta, isLoading, getApi } = useDashboardData(endpoint, {
    ...options,
    page,
    search,
    sort: sort.key,
    sortDir: sort.dir,
  })

  const handleSort = useCallback(
    (key: string) => {
      controllerRef.current.toggleSort(key)
      sync()
    },
    [sync]
  )

  const handleToggleExpand = useCallback(
    (id: number | string) => {
      controllerRef.current.toggleExpand(id)
      sync()
    },
    [sync]
  )

  const handleExplain = useCallback(
    async (queryId: number) => {
      // Toggle: if already showing for this query, close it
      const existing = controllerRef.current.getExplainState(queryId)
      if (existing && !existing.loading) {
        controllerRef.current.clearExplain()
        sync()
        return
      }

      controllerRef.current.startExplain(queryId)
      sync()
      try {
        const result = (await getApi().explainQuery(queryId)) as {
          plan?: unknown[]
          rows?: unknown[]
          error?: string
          message?: string
        }

        if (result && result.error) {
          controllerRef.current.completeExplain(queryId, {
            rows: [],
            error: result.error,
            message: result.message,
          } as ExplainResult)
        } else {
          controllerRef.current.completeExplain(queryId, {
            plan: (result?.plan || undefined) as ExplainResult['plan'],
            rows: (result?.rows || undefined) as ExplainResult['rows'],
          })
        }
      } catch (err) {
        console.warn('[ss] Query explain failed:', err)
        controllerRef.current.failExplain(
          queryId,
          err instanceof Error ? err.message : String(err)
        )
      }
      sync()
    },
    [getApi, sync]
  )

  const handleCloseExplain = useCallback(() => {
    controllerRef.current.clearExplain()
    sync()
  }, [sync])

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
    if (viewMode === 'grouped') {
      return `${queries.length} query patterns`
    }
    const stats = computeDashboardQuerySummary(queries, meta ?? undefined)
    const parts = [`${stats.totalCount} queries`]
    if (stats.slowCount > 0) parts.push(`${stats.slowCount} slow`)
    if (stats.dupCount > 0) parts.push(`${stats.dupCount} dup`)
    parts.push(`avg ${(stats.avgDuration || 0).toFixed(1)}ms`)
    return parts.join(', ')
  }, [viewMode, queries, meta])

  return (
    <QueriesContent
      mode="dashboard"
      controllerState={controllerState}
      queries={queries}
      meta={meta}
      isLoading={isLoading && !data}
      onSearchChange={handleSearchChange}
      onSort={handleSort}
      onToggleExpand={handleToggleExpand}
      onViewModeChange={handleViewModeChange}
      onPageChange={setPage}
      onExplain={handleExplain}
      onCloseExplain={handleCloseExplain}
      summary={summary}
      filterBarChildren={
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
      }
    />
  )
}

export default QueriesSection
