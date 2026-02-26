import React, { useState, useMemo, useCallback } from 'react'
import type { CacheStats, CacheEntry, DebugPanelProps } from '../../../../core/types.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { JsonViewer } from '../../shared/JsonViewer.js'

interface CacheTabProps {
  options?: DebugPanelProps
}

export function CacheTab({ options }: CacheTabProps) {
  const { data, isLoading, error } = useDebugData<CacheStats>('cache', options)
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [keyValue, setKeyValue] = useState<any>(null)

  const keys = useMemo(() => {
    const items = data?.keys || []
    if (!search) return items
    const lower = search.toLowerCase()
    return items.filter((k: CacheEntry) => k.key.toLowerCase().includes(lower))
  }, [data, search])

  const handleKeyClick = useCallback(
    async (key: string) => {
      if (selectedKey === key) {
        setSelectedKey(null)
        setKeyValue(null)
        return
      }
      setSelectedKey(key)
      // Fetch key value via API
      try {
        const { baseUrl = '', debugEndpoint = '/admin/api/debug', authToken } = options || {}
        const url = `${baseUrl}${debugEndpoint}/cache/${encodeURIComponent(key)}`
        const headers: Record<string, string> = { Accept: 'application/json' }
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`
        const resp = await fetch(url, { headers, credentials: 'same-origin' })
        const result = await resp.json()
        setKeyValue(result)
      } catch {
        setKeyValue({ error: 'Failed to fetch key value' })
      }
    },
    [selectedKey, options]
  )

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading cache data...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  if (!data) {
    return <div className="ss-dbg-empty">Cache inspector not available</div>
  }

  return (
    <div>
      {/* Stats row */}
      <div className="ss-dbg-cache-stats">
        <div className="ss-dbg-cache-stat">
          <span className="ss-dbg-cache-stat-label">Hit Rate:</span>
          <span className="ss-dbg-cache-stat-value">{data.hitRate.toFixed(1)}%</span>
        </div>
        <div className="ss-dbg-cache-stat">
          <span className="ss-dbg-cache-stat-label">Hits:</span>
          <span className="ss-dbg-cache-stat-value">{data.totalHits}</span>
        </div>
        <div className="ss-dbg-cache-stat">
          <span className="ss-dbg-cache-stat-label">Misses:</span>
          <span className="ss-dbg-cache-stat-value">{data.totalMisses}</span>
        </div>
      </div>

      {/* Search */}
      <div className="ss-dbg-search-bar">
        <input
          type="text"
          className="ss-dbg-search"
          placeholder="Filter keys..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ss-dbg-summary">{keys.length} keys</span>
      </div>

      {/* Key detail overlay */}
      {selectedKey && keyValue && (
        <div className="ss-dbg-cache-detail">
          <strong>{selectedKey}</strong>
          <button
            type="button"
            className="ss-dbg-btn-clear"
            onClick={() => setSelectedKey(null)}
            style={{ marginLeft: '8px' }}
          >
            Close
          </button>
          <JsonViewer data={keyValue} />
        </div>
      )}

      {/* Keys table */}
      {keys.length === 0 ? (
        <div className="ss-dbg-empty">No cache keys found</div>
      ) : (
        <table className="ss-dbg-table">
          <thead>
            <tr>
              <th>Key</th>
              <th style={{ width: '60px' }}>Type</th>
              <th style={{ width: '60px' }}>TTL</th>
              <th style={{ width: '60px' }}>Size</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((entry: CacheEntry) => (
              <tr
                key={entry.key}
                onClick={() => handleKeyClick(entry.key)}
                style={{ cursor: 'pointer' }}
              >
                <td style={{ color: 'var(--ss-sql-color)' }}>{entry.key}</td>
                <td>{entry.type}</td>
                <td>{entry.ttl > 0 ? `${entry.ttl}s` : '-'}</td>
                <td>{entry.size > 0 ? `${entry.size}B` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default CacheTab
