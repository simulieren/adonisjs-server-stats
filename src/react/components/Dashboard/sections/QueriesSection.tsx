import React, { useState, useCallback } from 'react'

import { formatDuration, formatTime } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface QueriesSectionProps {
  options?: DashboardHookOptions
}

export function QueriesSection({ options = {} }: QueriesSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list')
  const [expandedSql, setExpandedSql] = useState<number | null>(null)

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
      try {
        const result = (await mutate(`queries/${queryId}/explain`)) as { plan?: unknown }
        // Show in a simple alert or modal
        if (result && result.plan) {
          alert(JSON.stringify(result.plan, null, 2))
        }
      } catch (err) {
        console.warn('[ss] Query explain failed:', err)
      }
    },
    [mutate]
  )

  const queries = (data as Record<string, unknown>[]) || []

  return (
    <div>
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter queries...">
        <div className="ss-dash-view-toggle">
          <button
            type="button"
            className={`ss-dash-toggle-btn ${viewMode === 'list' ? 'ss-dash-active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
          <button
            type="button"
            className={`ss-dash-toggle-btn ${viewMode === 'grouped' ? 'ss-dash-active' : ''}`}
            onClick={() => setViewMode('grouped')}
          >
            Grouped
          </button>
        </div>
      </FilterBar>

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading queries...</div>
      ) : viewMode === 'grouped' ? (
        <DataTable
          columns={[
            {
              key: 'sql_normalized',
              label: 'Pattern',
              render: (v: string) => (
                <span style={{ color: 'var(--ss-sql-color)', fontSize: '11px' }}>{v}</span>
              ),
            },
            { key: 'count', label: 'Count', width: '60px', sortable: true },
            {
              key: 'avg_duration',
              label: 'Avg',
              width: '70px',
              sortable: true,
              render: (v: number) => formatDuration(v),
            },
            {
              key: 'min_duration',
              label: 'Min',
              width: '70px',
              render: (v: number) => formatDuration(v),
            },
            {
              key: 'max_duration',
              label: 'Max',
              width: '70px',
              render: (v: number) => formatDuration(v),
            },
            {
              key: 'total_duration',
              label: 'Total',
              width: '70px',
              sortable: true,
              render: (v: number) => formatDuration(v),
            },
          ]}
          data={queries}
          keyField="sql_normalized"
          sort={sort}
          sortDir={sortDir}
          onSort={handleSort}
          emptyMessage="No queries recorded"
        />
      ) : (
        <>
          <DataTable
            columns={[
              { key: 'id', label: '#', width: '40px' },
              {
                key: 'sql_text',
                label: 'SQL',
                render: (v: string, row: Record<string, unknown>) => (
                  <div>
                    <span
                      className={`ss-dash-sql ${expandedSql === (row.id as number) ? 'ss-dash-sql-expanded' : ''}`}
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
                      {v}
                    </span>
                    {row.method === 'select' && (
                      <button
                        type="button"
                        className="ss-dash-explain-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleExplain(row.id as number)
                        }}
                      >
                        EXPLAIN
                      </button>
                    )}
                  </div>
                ),
              },
              {
                key: 'duration',
                label: 'Duration',
                width: '70px',
                sortable: true,
                render: (v: number) => (
                  <span
                    className={`ss-dash-duration ${v > 500 ? 'ss-dash-very-slow' : v > 100 ? 'ss-dash-slow' : ''}`}
                  >
                    {formatDuration(v)}
                  </span>
                ),
              },
              { key: 'method', label: 'Type', width: '60px' },
              { key: 'model', label: 'Model', width: '90px' },
              {
                key: 'created_at',
                label: 'Time',
                width: '90px',
                sortable: true,
                render: (v: string) => <span className="ss-dash-event-time">{formatTime(v)}</span>,
              },
            ]}
            data={queries}
            sort={sort}
            sortDir={sortDir}
            onSort={handleSort}
            emptyMessage="No queries recorded"
          />
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
