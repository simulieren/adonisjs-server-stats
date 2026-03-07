import React, { useState, useCallback, useEffect } from 'react'

import { timeAgo, formatTime } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'

import type { DashboardHookOptions } from '../../../../core/types.js'

interface EmailsSectionProps {
  options?: DashboardHookOptions
}

export function EmailsSection({ options = {} }: EmailsSectionProps) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const { data, meta, isLoading } = useDashboardData('emails', { ...options, page, search })
  const emails = (data as Record<string, unknown>[]) || []

  useEffect(() => setPage(1), [search])

  const handlePreview = useCallback(
    async (email: Record<string, unknown>) => {
      if (email.html) {
        setPreviewId(email.id as number)
        setPreviewHtml(email.html as string)
        return
      }
      // Fetch preview from API
      try {
        const { baseUrl = '', dashboardEndpoint = '/__stats/api', authToken } = options
        const url = `${baseUrl}${dashboardEndpoint}/emails/${email.id}/preview`
        const headers: Record<string, string> = { Accept: 'text/html' }
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`
        const resp = await fetch(url, { headers, credentials: 'same-origin' })
        const html = await resp.text()
        setPreviewId(email.id as number)
        setPreviewHtml(html)
      } catch {
        // Silently fail
      }
    },
    [options]
  )

  if (previewId && previewHtml) {
    const email = emails.find((e) => e.id === previewId)
    return (
      <div className="ss-dash-email-preview" id="ss-dash-email-preview">
        <div className="ss-dash-email-preview-header">
          <div className="ss-dash-email-preview-meta" id="ss-dash-email-preview-meta">
            {email && (
              <>
                <strong>Subject:</strong> {email.subject as string}
                &nbsp;&nbsp;|&nbsp;&nbsp;<strong>From:</strong>{' '}
                {(email.from_addr || email.from) as string}
                &nbsp;&nbsp;|&nbsp;&nbsp;<strong>To:</strong>{' '}
                {(email.to_addr || email.to) as string}
                {(email.cc || email.cc_addr) && (
                  <>
                    &nbsp;&nbsp;|&nbsp;&nbsp;<strong>CC:</strong>{' '}
                    {(email.cc || email.cc_addr) as string}
                  </>
                )}
                &nbsp;&nbsp;|&nbsp;&nbsp;<strong>Status:</strong>{' '}
                <span className={`ss-dash-badge ss-dash-email-status-${email.status as string}`}>
                  {email.status as string}
                </span>
                {(email.mailer as string) && (
                  <>
                    &nbsp;&nbsp;|&nbsp;&nbsp;<strong>Mailer:</strong> {email.mailer as string}
                  </>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            className="ss-dash-btn"
            id="ss-dash-email-preview-close"
            onClick={() => {
              setPreviewId(null)
              setPreviewHtml(null)
            }}
          >
            Close
          </button>
        </div>
        <iframe
          className="ss-dash-email-iframe"
          id="ss-dash-email-iframe"
          srcDoc={previewHtml}
          title="Email preview"
          sandbox=""
        />
      </div>
    )
  }

  return (
    <div>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Filter emails..."
        summary={`${meta?.total ?? 0} emails`}
      />
      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading emails...</div>
      ) : (
        <>
          <div className="ss-dash-table-wrap">
            <DataTable
              columns={[
                {
                  key: 'id',
                  label: '#',
                  width: '40px',
                  render: (v: unknown) => (
                    <span style={{ color: 'var(--ss-dim)' }}>{v as string}</span>
                  ),
                },
                {
                  key: 'from',
                  label: 'From',
                  width: '150px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const from = (row.from_addr || row.from || '') as string
                    return (
                      <span
                        title={from}
                        style={{
                          color: 'var(--ss-text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {from}
                      </span>
                    )
                  },
                },
                {
                  key: 'to',
                  label: 'To',
                  width: '150px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const to = (row.to_addr || row.to || '') as string
                    return (
                      <span
                        title={to}
                        style={{
                          color: 'var(--ss-text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {to}
                      </span>
                    )
                  },
                },
                {
                  key: 'subject',
                  label: 'Subject',
                  render: (v: unknown) => {
                    const subject = (v || '') as string
                    return (
                      <span
                        title={subject}
                        style={{
                          color: 'var(--ss-sql-color)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {subject}
                      </span>
                    )
                  },
                },
                {
                  key: 'status',
                  label: 'Status',
                  width: '80px',
                  render: (v: unknown) => {
                    const status = (v || '') as string
                    return (
                      <span className={`ss-dash-badge ss-dash-email-status-${status}`}>
                        {status}
                      </span>
                    )
                  },
                },
                {
                  key: 'attachmentCount',
                  label: 'ATT',
                  width: '40px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const count = (row.attachment_count || row.attachmentCount || 0) as number
                    return count > 0 ? (
                      <span
                        style={{ color: 'var(--ss-dim)', textAlign: 'center', display: 'block' }}
                      >
                        {count}
                      </span>
                    ) : (
                      <span
                        style={{ color: 'var(--ss-dim)', textAlign: 'center', display: 'block' }}
                      >
                        -
                      </span>
                    )
                  },
                },
                {
                  key: 'mailer',
                  label: 'Mailer',
                  width: '70px',
                  render: (v: unknown) => {
                    const mailer = (v || '') as string
                    return (
                      <span
                        title={mailer}
                        style={{
                          color: 'var(--ss-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {mailer}
                      </span>
                    )
                  },
                },
                {
                  key: 'createdAt',
                  label: 'Time',
                  width: '80px',
                  render: (_v: unknown, row: Record<string, unknown>) => {
                    const ts = (row.createdAt || row.created_at || row.timestamp) as string
                    return (
                      <span
                        className="ss-dash-event-time"
                        style={{ whiteSpace: 'nowrap' }}
                        title={formatTime(ts)}
                      >
                        {timeAgo(ts)}
                      </span>
                    )
                  },
                },
              ]}
              data={emails}
              onRowClick={handlePreview}
              rowClassName="ss-dash-email-row"
              emptyMessage="No emails captured yet"
            />
          </div>
          {meta && (
            <Pagination
              page={meta.page}
              lastPage={meta.lastPage}
              total={meta.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}

export default EmailsSection
