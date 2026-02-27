import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'

import { timeAgo } from '../../../../core/formatters.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import { useDebugData } from '../../../hooks/useDebugData.js'

import type { EmailRecord, DebugPanelProps } from '../../../../core/types.js'

interface EmailsTabProps {
  options?: DebugPanelProps
}

export function EmailsTab({ options }: EmailsTabProps) {
  const { data, isLoading, error } = useDebugData<{ emails: EmailRecord[] }>('emails', options)
  const [search, setSearch] = useState('')
  const [previewId, setPreviewId] = useState<number | null>(null)

  const emails = useMemo(() => {
    const items = data?.emails || []
    if (!search) return items
    const lower = search.toLowerCase()
    return items.filter(
      (e) =>
        e.subject.toLowerCase().includes(lower) ||
        e.to.toLowerCase().includes(lower) ||
        e.from.toLowerCase().includes(lower)
    )
  }, [data, search])

  const previewEmail = useMemo(() => emails.find((e) => e.id === previewId), [emails, previewId])

  const closePreview = useCallback(() => setPreviewId(null), [])

  const statusColorMap: Record<string, string> = {
    sent: 'ss-dbg-email-status-sent',
    sending: 'ss-dbg-email-status-sending',
    queued: 'ss-dbg-email-status-queued',
    failed: 'ss-dbg-email-status-failed',
  }

  const tableRef = useRef<HTMLTableElement>(null)
  useEffect(() => {
    if (tableRef.current) {
      return initResizableColumns(tableRef.current)
    }
  }, [emails])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading emails...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  // Email preview overlay
  if (previewEmail) {
    return (
      <div className="ss-dbg-email-preview">
        <div className="ss-dbg-email-preview-header">
          <div className="ss-dbg-email-preview-meta">
            <div>
              <strong>Subject:</strong> {previewEmail.subject}
            </div>
            <div>
              <strong>From:</strong> {previewEmail.from}
            </div>
            <div>
              <strong>To:</strong> {previewEmail.to}
            </div>
            {previewEmail.cc && (
              <div>
                <strong>CC:</strong> {previewEmail.cc}
              </div>
            )}
          </div>
          <button className="ss-dbg-close" onClick={closePreview} type="button">
            {'\u00D7'}
          </button>
        </div>
        {previewEmail.html ? (
          <iframe
            className="ss-dbg-email-iframe"
            srcDoc={previewEmail.html}
            title="Email preview"
            sandbox=""
          />
        ) : (
          <div style={{ padding: '12px', whiteSpace: 'pre-wrap' }}>
            {previewEmail.text || 'No content'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="ss-dbg-search-bar">
        <input
          type="text"
          className="ss-dbg-search"
          placeholder="Filter emails..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ss-dbg-summary">{emails.length} emails</span>
      </div>

      {emails.length === 0 ? (
        <div className="ss-dbg-empty">No emails captured</div>
      ) : (
        <table ref={tableRef} className="ss-dbg-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Subject</th>
              <th>To</th>
              <th>Mailer</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {emails.map((email) => (
              <tr
                key={email.id}
                className="ss-dbg-email-row"
                onClick={() => setPreviewId(email.id)}
              >
                <td>{email.id}</td>
                <td>{email.subject}</td>
                <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {email.to}
                </td>
                <td>{email.mailer}</td>
                <td>
                  <span className={`ss-dbg-email-status ${statusColorMap[email.status] || ''}`}>
                    {email.status}
                  </span>
                </td>
                <td className="ss-dbg-event-time">{timeAgo(email.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default EmailsTab
