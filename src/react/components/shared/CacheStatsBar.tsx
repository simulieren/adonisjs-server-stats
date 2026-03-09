import React from 'react'

export interface CacheStatsBarProps {
  hitRate: number
  hits: number
  misses: number
  keys: number
}

/**
 * Shared cache stats bar showing Hit Rate, Hits, Misses, and Keys.
 * Uses neutral `ss-cache-stats` CSS classes (with backward-compatible
 * aliases for `ss-dash-` and `ss-dbg-` prefixes in components.css).
 */
export function CacheStatsBar({ hitRate, hits, misses, keys }: CacheStatsBarProps) {
  return (
    <div className="ss-cache-stats">
      <div className="ss-cache-stat">
        <span className="ss-cache-stat-label">Hit Rate:</span>
        <span className="ss-cache-stat-value">{hitRate.toFixed(1)}%</span>
      </div>
      <div className="ss-cache-stat">
        <span className="ss-cache-stat-label">Hits:</span>
        <span className="ss-cache-stat-value">{hits}</span>
      </div>
      <div className="ss-cache-stat">
        <span className="ss-cache-stat-label">Misses:</span>
        <span className="ss-cache-stat-value">{misses}</span>
      </div>
      <div className="ss-cache-stat">
        <span className="ss-cache-stat-label">Keys:</span>
        <span className="ss-cache-stat-value">{keys}</span>
      </div>
    </div>
  )
}

export default CacheStatsBar
