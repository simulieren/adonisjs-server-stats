import React, { useState, useCallback } from 'react'

import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { formatTtl, formatCacheSize } from '../../../../core/formatters.js'
import { JsonViewer } from '../../shared/JsonViewer.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'

import type {
  DashboardHookOptions,
  DashboardCacheResponse,
} from '../../../../core/types.js'

interface CacheSectionProps {
  options?: DashboardHookOptions
}

export function CacheSection({ options = {} }: CacheSectionProps) {
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [keyValue, setKeyValue] = useState<unknown>(null)
  const [keyValueLoading, setKeyValueLoading] = useState(false)
  const [keyValueError, setKeyValueError] = useState<string | null>(null)

  const { data, isLoading, mutate, getApi } = useDashboardData<DashboardCacheResponse>('cache', {
    ...options,
    search,
  })
  const cacheData = data

  const handleDelete = useCallback(
    async (key: string) => {
      if (!confirm(`Delete cache key "${key}"?`)) return
      try {
        await mutate(`cache/${encodeURIComponent(key)}`, 'delete')
        // Clear selection if the deleted key was selected
        if (selectedKey === key) {
          setSelectedKey(null)
          setKeyValue(null)
          setKeyValueError(null)
        }
      } catch {
        // Silently fail
      }
    },
    [mutate, selectedKey]
  )

  const handleKeyClick = useCallback(
    async (key: string) => {
      if (selectedKey === key) {
        setSelectedKey(null)
        setKeyValue(null)
        setKeyValueError(null)
        return
      }
      setSelectedKey(key)
      setKeyValue(null)
      setKeyValueError(null)
      setKeyValueLoading(true)
      try {
        const api = getApi()
        const result = await api.fetchCacheKey(key)
        setKeyValue(
          result.value !== undefined
            ? result.value
            : result.data !== undefined
              ? result.data
              : result
        )
        setKeyValueError(null)
      } catch {
        setKeyValue(null)
        setKeyValueError('Failed to fetch key value')
      } finally {
        setKeyValueLoading(false)
      }
    },
    [selectedKey, getApi]
  )

  return (
    <div>
      {/* Stats */}
      {cacheData?.available && cacheData?.stats && (
        <div className="ss-dash-cache-stats">
          <div className="ss-dash-cache-stat">
            <span className="ss-dash-cache-stat-label">Hit Rate:</span>
            <span className="ss-dash-cache-stat-value">
              {(cacheData.stats.hitRate ?? 0).toFixed(1)}%
            </span>
          </div>
          <div className="ss-dash-cache-stat">
            <span className="ss-dash-cache-stat-label">Hits:</span>
            <span className="ss-dash-cache-stat-value">{cacheData.stats.hits ?? 0}</span>
          </div>
          <div className="ss-dash-cache-stat">
            <span className="ss-dash-cache-stat-label">Misses:</span>
            <span className="ss-dash-cache-stat-value">{cacheData.stats.misses ?? 0}</span>
          </div>
          <div className="ss-dash-cache-stat">
            <span className="ss-dash-cache-stat-label">Keys:</span>
            <span className="ss-dash-cache-stat-value">
              {cacheData.stats.totalKeys || cacheData.stats.keyCount || cacheData.keys?.length || 0}
            </span>
          </div>
        </div>
      )}

      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter cache keys..." summary={`${(cacheData?.keys || cacheData?.data || []).length} keys`} />

      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading cache...</div>
      ) : !cacheData || !cacheData.available ? (
        <div className="ss-dash-empty">Cache inspector not available</div>
      ) : (
        <div className="ss-dash-table-wrap">
          <DataTable
            columns={[
              {
                key: 'key',
                label: 'Key',
                render: (v: string) => (
                  <span
                    title={v}
                    style={{
                      color: 'var(--ss-sql-color)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                  >
                    {v}
                  </span>
                ),
              },
              {
                key: 'type',
                label: 'Type',
                width: '70px',
                render: (v: string) => (
                  <span style={{ color: 'var(--ss-muted)' }}>{v}</span>
                ),
              },
              {
                key: 'size',
                label: 'Size',
                width: '60px',
                render: (v: number | null | undefined) =>
                  v !== null && v !== undefined && v > 0 ? formatCacheSize(v) : '-',
              },
              {
                key: 'ttl',
                label: 'TTL',
                width: '70px',
                render: (v: number) => (v > 0 ? formatTtl(v) : '-'),
              },
              {
                key: '_actions',
                label: '',
                width: '60px',
                render: (_: unknown, row: Record<string, unknown>) => (
                  <button
                    type="button"
                    className="ss-dash-retry-btn"
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
            data={(cacheData.keys || cacheData.data || []) as unknown as Record<string, unknown>[]}
            keyField="key"
            onRowClick={(row: Record<string, unknown>) =>
              handleKeyClick(row.key as string)
            }
            emptyMessage="No cache keys found"
          />
        </div>
      )}

      {selectedKey && (
        <div className="ss-dash-cache-detail">
          <h4>Key: {selectedKey}</h4>
          {keyValueLoading ? (
            <div className="ss-dash-empty">Loading value...</div>
          ) : keyValueError ? (
            <div className="ss-dash-empty" style={{ color: 'var(--ss-red-fg)' }}>
              {keyValueError}
            </div>
          ) : (
            <JsonViewer data={keyValue} />
          )}
        </div>
      )}
    </div>
  )
}

export default CacheSection
