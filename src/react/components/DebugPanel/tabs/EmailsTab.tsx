import React, { useState, useMemo, useCallback } from 'react'

import { timeAgo, formatTime } from '../../../../core/formatters.js'
import { useDebugData } from '../../../hooks/useDebugData.js'
import { useResizableTable } from '../../../hooks/useResizableTable.js'

import type { EmailRecord, DebugPanelProps } from '../../../../core/types.js'

interface EmailsTabProps {
  options?: DebugPanelProps
}

export function EmailsTab({ options }: EmailsTabProps) {
  const { data, isLoading, error } = useDebugData<{ emails: EmailRecord[] }>('emails', options)
  const [search, setSearch] = useState('')
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const emails = useMemo(() => {
    const items = data?.emails || []
    if (!search) return items
    const lower = search.toLowerCase()
    return items.filter(
      (e) =>
        (e.subject || '').toLowerCase().includes(lower) ||
        (e.to || '').toLowerCase().includes(lower) ||
        (e.from || '').toLowerCase().includes(lower) ||
        (e.mailer || '').toLowerCase().includes(lower)
    )
  }, [data, search])

  const previewEmail = useMemo(() => emails.find((e) => e.id === previewId), [emails, previewId])

  const openPreview = useCallback(
    async (email: EmailRecord) => {
      setPreviewId(email.id)
      setPreviewHtml(email.html || null)

      if (!email.html && email.id) {
        setLoadingPreview(true)
        try {
          const endpoint = options?.debugEndpoint || '/admin/api/debug'
          const headers: Record<string, string> = {}
          if (options?.authToken) headers['Authorization'] = `Bearer ${options.authToken}`
          const res = await fetch(`${endpoint}/emails/${email.id}/preview`, {
            headers,
            credentials: options?.authToken ? 'omit' : 'include',
          })
          if (res.ok) {
            setPreviewHtml(await res.text())
          }
        } catch {
          // Preview fetch failed
        } finally {
          setLoadingPreview(false)
        }
      }
    },
    [options]
  )

  const closePreview = useCallback(() => {
    setPreviewId(null)
    setPreviewHtml(null)
    setLoadingPreview(false)
  }, [])

  const statusColorMap: Record<string, string> = {
    sent: 'ss-dbg-email-status-sent',
    sending: 'ss-dbg-email-status-sending',
    queueing: 'ss-dbg-email-status-queued',
    queued: 'ss-dbg-email-status-queued',
    failed: 'ss-dbg-email-status-failed',
  }

  const tableRef = useResizableTable([emails])

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
          <button className="ss-dbg-btn-clear" onClick={closePreview} type="button">
            {'\u00D7'}
          </button>
        </div>
        {loadingPreview ? (
          <div className="ss-dbg-empty">Loading preview...</div>
        ) : previewHtml ? (
          <iframe
            className="ss-dbg-email-iframe"
            srcDoc={previewHtml}
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
          <colgroup>
            <col style={{ width: '50px' }} />
            <col style={{ width: '140px' }} />
            <col style={{ width: '140px' }} />
            <col />
            <col style={{ width: '70px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '40px' }} />
            <col style={{ width: '80px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>From</th>
              <th>To</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Mailer</th>
              <th title="Attachments">{'\u{1F4CE}'}</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {emails.map((email) => (
              <tr key={email.id} className="ss-dbg-email-row" onClick={() => openPreview(email)}>
                <td className="ss-dbg-c-dim" style={{ whiteSpace: 'nowrap' }}>
                  {email.id}
                </td>
                <td className="ss-dbg-c-secondary" title={email.from}>
                  {email.from}
                </td>
                <td className="ss-dbg-c-secondary" title={email.to}>
                  {email.to}
                </td>
                <td className="ss-dbg-c-sql">{email.subject}</td>
                <td>
                  <span className={`ss-dbg-email-status ${statusColorMap[email.status] || ''}`}>
                    {email.status}
                  </span>
                </td>
                <td className="ss-dbg-c-muted">{email.mailer}</td>
                <td className="ss-dbg-c-dim" style={{ textAlign: 'center' }}>
                  {email.attachmentCount > 0 ? email.attachmentCount : '-'}
                </td>
                <td
                  className="ss-dbg-event-time"
                  title={formatTime(
                    email.timestamp ||
                      (email as unknown as Record<string, number>).created_at ||
                      (email as unknown as Record<string, number>).createdAt
                  )}
                >
                  {timeAgo(
                    email.timestamp ||
                      (email as unknown as Record<string, number>).created_at ||
                      (email as unknown as Record<string, number>).createdAt
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default EmailsTab
