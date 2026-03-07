import React, { useState } from 'react'

import { formatTime, timeAgo } from '../../../core/formatters.js'
import {
  resolveLogLevel,
  resolveLogMessage,
  resolveLogTimestamp,
  resolveLogRequestId,
  getLogLevelCssClass,
  getStructuredData,
} from '../../../core/log-utils.js'
import { JsonViewer } from './JsonViewer.js'

import type { LogEntry } from '../../../core/log-utils.js'

interface RelatedLogsProps {
  logs: LogEntry[]
  classPrefix?: 'ss-dash' | 'ss-dbg'
}

export function RelatedLogs({ logs, classPrefix = 'ss-dash' }: RelatedLogsProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  if (logs.length === 0) return null

  return (
    <div>
      <div className={`${classPrefix}-related-logs-title`}>
        Related Logs
        <span className={`${classPrefix}-related-logs-count`}>({logs.length})</span>
      </div>
      <div className={`${classPrefix}-log-entries`} style={{ overflow: 'auto' }}>
        {logs.map((log, i) => {
          const level = resolveLogLevel(log)
          const message = resolveLogMessage(log)
          const reqId = resolveLogRequestId(log)
          const ts = resolveLogTimestamp(log)
          const structured = getStructuredData(log)

          return (
            <React.Fragment key={(log.id as string) || i}>
              <div
                className={`${classPrefix}-log-entry${structured ? ` ${classPrefix}-log-entry-expandable` : ''}`}
                onClick={() => structured && setExpandedIndex(expandedIndex === i ? null : i)}
              >
                <span className={`${classPrefix}-log-level ${getLogLevelCssClass(level, `${classPrefix}-log-level`)}`}>
                  {level.toUpperCase()}
                </span>
                <span className={`${classPrefix}-log-time`} title={ts ? formatTime(ts) : ''}>
                  {ts ? timeAgo(ts) : '-'}
                </span>
                {reqId ? (
                  <span className={`${classPrefix}-log-reqid`} title={reqId}>
                    {reqId.slice(0, 8)}
                  </span>
                ) : (
                  <span className={`${classPrefix}-log-reqid-empty`}>--</span>
                )}
                {structured ? (
                  <span className={`${classPrefix}-log-expand-icon${expandedIndex === i ? ` ${classPrefix}-log-expand-icon-open` : ''}`}>
                    ▶
                  </span>
                ) : (
                  <span style={{ width: 14 }} />
                )}
                <span className={`${classPrefix}-log-msg`}>{message}</span>
              </div>
              {expandedIndex === i && structured && (
                <div className={`${classPrefix}-log-detail`}>
                  <JsonViewer data={structured} classPrefix={classPrefix} defaultExpanded />
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
