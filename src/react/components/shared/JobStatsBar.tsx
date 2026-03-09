import React from 'react'

import type { JobStats } from '../../../core/types.js'

interface JobStatsBarProps {
  stats: JobStats | null
  /** CSS class prefix: 'ss-dash' for dashboard, 'ss-dbg' for debug panel, or 'ss' for neutral. */
  classPrefix?: 'ss' | 'ss-dash' | 'ss-dbg'
}

/**
 * Shared stats bar showing Active/Waiting/Delayed/Completed/Failed counts.
 * Used by both Dashboard JobsSection and DebugPanel JobsTab.
 */
export function JobStatsBar({ stats, classPrefix = 'ss' }: JobStatsBarProps) {
  if (!stats) return null

  const p = classPrefix

  return (
    <div className={`${p}-job-stats`}>
      <div className={`${p}-job-stat`}>
        <span className={`${p}-job-stat-label`}>Active:</span>
        <span className={`${p}-job-stat-value`}>{stats.active ?? 0}</span>
      </div>
      <div className={`${p}-job-stat`}>
        <span className={`${p}-job-stat-label`}>Waiting:</span>
        <span className={`${p}-job-stat-value`}>{stats.waiting ?? 0}</span>
      </div>
      <div className={`${p}-job-stat`}>
        <span className={`${p}-job-stat-label`}>Delayed:</span>
        <span className={`${p}-job-stat-value`}>{stats.delayed ?? 0}</span>
      </div>
      <div className={`${p}-job-stat`}>
        <span className={`${p}-job-stat-label`}>Completed:</span>
        <span className={`${p}-job-stat-value`}>{stats.completed ?? 0}</span>
      </div>
      <div className={`${p}-job-stat`}>
        <span className={`${p}-job-stat-label`}>Failed:</span>
        <span className={`${p}-job-stat-value ${p}-c-red`}>{stats.failed ?? 0}</span>
      </div>
    </div>
  )
}

export default JobStatsBar
