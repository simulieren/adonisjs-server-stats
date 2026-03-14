import React, { useState, useMemo, useCallback, useRef } from 'react'

import { formatDuration } from '../../../../core/formatters.js'
import {
  filterQueries,
  countDuplicateQueries,
  computeQuerySummary,
} from '../../../../core/query-utils.js'
import { QueriesController } from '../../../../core/queries-controller.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { QueriesContent } from '../../shared/QueriesContent.js'

import type { ExplainResult } from '../../../../core/queries-controller.js'
import type { QueryRecord, DebugPanelProps } from '../../../../core/types.js'

interface QueriesTabProps {
  options?: DebugPanelProps
}

export function QueriesTab({ options }: QueriesTabProps) {
  const { baseUrl = '', debugEndpoint = '/admin/api/debug', authToken } = options || {}
  const { data, isLoading, error } = useDebugData<{ queries: QueryRecord[] }>('queries', options)

  const controllerRef = useRef(new QueriesController('list'))
  const [controllerState, setControllerState] = useState(controllerRef.current.state)

  const sync = useCallback(() => {
    setControllerState({ ...controllerRef.current.state })
  }, [])

  const { search } = controllerState

  const handleSearchChange = useCallback(
    (value: string) => {
      controllerRef.current.setSearch(value)
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

  const handleSort = useCallback((_key: string) => {}, [])

  const handleExplain = useCallback(
    async (queryId: number) => {
      const existing = controllerRef.current.getExplainState(queryId)
      if (existing && !existing.loading) {
        controllerRef.current.clearExplain()
        sync()
        return
      }

      controllerRef.current.startExplain(queryId)
      sync()
      try {
        const headers: Record<string, string> = {}
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`
        const url = `${baseUrl}${debugEndpoint}/queries/${queryId}/explain`
        const res = await fetch(url, { headers })
        const result = (await res.json()) as {
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
    [baseUrl, debugEndpoint, authToken, sync]
  )

  const handleCloseExplain = useCallback(() => {
    controllerRef.current.clearExplain()
    sync()
  }, [sync])

  const allQueries = useMemo(() => data?.queries || [], [data])
  const queries = useMemo(() => filterQueries(allQueries, search), [allQueries, search])
  const dupCounts = useMemo(() => countDuplicateQueries(allQueries), [allQueries])
  const summaryStats = useMemo(
    () => computeQuerySummary(allQueries, dupCounts),
    [allQueries, dupCounts]
  )

  if (isLoading && !data) {
    return <div className="ss-dash-empty">Loading queries...</div>
  }

  if (error) {
    return <div className="ss-dash-empty">Error: {error.message}</div>
  }

  const summaryNode = (
    <>
      {queries.length} queries
      {summaryStats.slowCount > 0 && ` | ${summaryStats.slowCount} slow`}
      {summaryStats.dupCount > 0 && ` | ${summaryStats.dupCount} dup`}
      {queries.length > 0 && ` | avg ${formatDuration(summaryStats.avgDuration)}`}
    </>
  )

  return (
    <QueriesContent
      mode="debug"
      controllerState={controllerState}
      queries={queries as unknown as Record<string, unknown>[]}
      onSearchChange={handleSearchChange}
      onSort={handleSort}
      onToggleExpand={handleToggleExpand}
      onExplain={handleExplain}
      onCloseExplain={handleCloseExplain}
      summary={summaryNode}
    />
  )
}

export default QueriesTab
