import React, { useState } from 'react'

import { LogEntryRow } from './LogEntryRow.js'

import type { LogEntry } from '../../../core/log-utils.js'

interface RelatedLogsProps {
  logs: LogEntry[]
  onReqIdClick?: (reqId: string) => void
}

export function RelatedLogs({ logs, onReqIdClick }: RelatedLogsProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  if (logs.length === 0) return null

  return (
    <div>
      <div className="ss-related-logs-title">
        Related Logs
        <span className="ss-related-logs-count">({logs.length})</span>
      </div>
      <div style={{ overflow: 'auto' }}>
        {logs.map((log, i) => (
          <LogEntryRow
            key={(log.id as string) || i}
            log={log}
            index={i}
            expanded={expandedIndex === i}
            onToggleExpand={(idx) => setExpandedIndex(expandedIndex === idx ? null : idx)}
            onReqIdClick={onReqIdClick}
          />
        ))}
      </div>
    </div>
  )
}
