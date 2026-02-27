import React, { useState, useCallback } from 'react'

import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { JsonViewer } from '../../shared/JsonViewer.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface CacheResponse {
  hitRate?: number
  totalHits?: number
  totalMisses?: number
  keys?: Array<{ key: string; type: string; ttl: number; size: number }>
}

interface CacheSectionProps {
  options?: DashboardHookOptions
}

export function CacheSection({ options = {} }: CacheSectionProps) {
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const { data, isLoading, mutate } = useDashboardData<CacheResponse>('cache', { ...options, search })
  const cacheData = data

  const handleDelete = useCallback(
    async (key: string) => {
      if (!confirm(`Delete cache key "${key}"?`)) return
      try {
        await mutate(`cache/${encodeURIComponent(key)}`, 'delete')
      } catch {
        // Silently fail
      }
    },
    [mutate]
  )

  return (
    <div>
      {/* Stats */}
      {cacheData && (
        <div className="ss-dash-stats-row">
          <div className="ss-dash-stat-card">
            <span className="ss-dash-stat-label">Hit Rate</span>
            <span className="ss-dash-stat-value">{(cacheData.hitRate ?? 0).toFixed(1)}%</span>
          </div>
          <div className="ss-dash-stat-card">
            <span className="ss-dash-stat-label">Total Hits</span>
            <span className="ss-dash-stat-value">{cacheData.totalHits ?? 0}</span>
          </div>
          <div className="ss-dash-stat-card">
            <span className="ss-dash-stat-label">Total Misses</span>
            <span className="ss-dash-stat-value">{cacheData.totalMisses ?? 0}</span>
          </div>
        </div>
      )}

      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter cache keys..." />

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading cache...</div>
      ) : !cacheData ? (
        <div className="ss-dash-empty">Cache inspector not available</div>
      ) : (
        <DataTable
          columns={[
            {
              key: 'key',
              label: 'Key',
              render: (v: string) => <span style={{ color: 'var(--ss-sql-color)' }}>{v}</span>,
            },
            { key: 'type', label: 'Type', width: '70px' },
            {
              key: 'ttl',
              label: 'TTL',
              width: '70px',
              render: (v: number) => (v > 0 ? `${v}s` : '-'),
            },
            {
              key: 'size',
              label: 'Size',
              width: '70px',
              render: (v: number) => (v > 0 ? `${v}B` : '-'),
            },
            {
              key: '_actions',
              label: '',
              width: '60px',
              render: (_: unknown, row: Record<string, unknown>) => (
                <button
                  type="button"
                  className="ss-dash-btn-danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(row.key as string)
                  }}
                >
                  Delete
                </button>
              ),
            },
          ]}
          data={cacheData.keys || []}
          keyField="key"
          onRowClick={(row: Record<string, unknown>) => setSelectedKey(selectedKey === row.key ? null : row.key as string)}
          emptyMessage="No cache keys found"
        />
      )}

      {selectedKey && (
        <div className="ss-dash-detail-panel">
          <h4>Key: {selectedKey}</h4>
          <JsonViewer data={selectedKey} />
        </div>
      )}
    </div>
  )
}

export default CacheSection
