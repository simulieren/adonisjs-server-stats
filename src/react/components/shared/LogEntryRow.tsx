import React from 'react'

import { TimeAgoCell } from './TimeAgoCell.js'
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

export interface LogEntryRowProps {
  log: LogEntry | Record<string, unknown>
  index: number
  expanded: boolean
  onToggleExpand: (index: number) => void
  onReqIdClick?: (reqId: string) => void
}

export function LogEntryRow({ log, index, expanded, onToggleExpand, onReqIdClick }: LogEntryRowProps) {
  const level = resolveLogLevel(log)
  const message = resolveLogMessage(log)
  const ts = resolveLogTimestamp(log)
  const reqId = resolveLogRequestId(log)
  const structured = getStructuredData(log)

  return (
    <React.Fragment>
      <div
        className={`ss-log-entry${structured ? ' ss-log-entry-expandable' : ''}`}
        onClick={() => structured && onToggleExpand(index)}
      >
        <span className={`ss-log-level ${getLogLevelCssClass(level, 'ss-log-level')}`}>
          {level.toUpperCase()}
        </span>
        <TimeAgoCell ts={ts} className="ss-log-time" />
        {reqId ? (
          <span
            className="ss-log-reqid"
            title={reqId}
            onClick={
              onReqIdClick
                ? (e) => {
                    e.stopPropagation()
                    onReqIdClick(reqId)
                  }
                : undefined
            }
            role={onReqIdClick ? 'button' : undefined}
            tabIndex={onReqIdClick ? 0 : undefined}
            onKeyDown={
              onReqIdClick
                ? (e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      onReqIdClick(reqId)
                    }
                  }
                : undefined
            }
          >
            {reqId.slice(0, 8)}
          </span>
        ) : (
          <span className="ss-log-reqid-empty">--</span>
        )}
        {structured ? (
          <span className={`ss-log-expand-icon${expanded ? ' ss-log-expand-icon-open' : ''}`}>
            ▶
          </span>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <span className="ss-log-msg">{message}</span>
      </div>
      {expanded && structured && (
        <div className="ss-log-detail">
          <JsonViewer data={structured} classPrefix="ss-dbg" defaultExpanded />
        </div>
      )}
    </React.Fragment>
  )
}
