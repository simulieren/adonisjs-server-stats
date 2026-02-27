import React, { useState, useCallback } from 'react'

import { timeAgo } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { Badge } from '../../shared/Badge.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../shared/FilterBar.js'
import { Pagination } from '../shared/Pagination.js'

import type { BadgeColor, DashboardHookOptions } from '../../../../core/types.js'

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

  const statusColor: Record<string, string> = {
    sent: 'green',
    sending: 'amber',
    queued: 'blue',
    failed: 'red',
  }

  if (previewId && previewHtml) {
    const email = emails.find((e) => e.id === previewId)
    return (
      <div className="ss-dash-email-preview">
        <div className="ss-dash-email-preview-header">
          <div>
            {email && (
              <>
                <div>
                  <strong>Subject:</strong> {email.subject as string}
                </div>
                <div>
                  <strong>From:</strong> {(email.from_addr || email.from) as string}
                </div>
                <div>
                  <strong>To:</strong> {(email.to_addr || email.to) as string}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            className="ss-dash-btn"
            onClick={() => {
              setPreviewId(null)
              setPreviewHtml(null)
            }}
          >
            Close
          </button>
        </div>
        <iframe
          srcDoc={previewHtml}
          title="Email preview"
          sandbox=""
          style={{ flex: 1, border: 'none', background: '#fff' }}
        />
      </div>
    )
  }

  return (
    <div>
      <FilterBar search={search} onSearchChange={setSearch} placeholder="Filter emails..." />
      {isLoading && !data ? (
        <div className="ss-dash-empty">Loading emails...</div>
      ) : (
        <>
          <DataTable
            columns={[
              { key: 'id', label: '#', width: '40px' },
              {
                key: 'subject',
                label: 'Subject',
                render: (v: string) => <span style={{ color: 'var(--ss-text)' }}>{v}</span>,
              },
              { key: 'to_addr', label: 'To', width: '150px' },
              { key: 'mailer', label: 'Mailer', width: '70px' },
              {
                key: 'status',
                label: 'Status',
                width: '80px',
                render: (v: string) => (
                  <Badge color={(statusColor[v] || 'muted') as BadgeColor}>{v}</Badge>
                ),
              },
              {
                key: 'created_at',
                label: 'Time',
                width: '80px',
                render: (v: string) => <span className="ss-dash-event-time">{timeAgo(v)}</span>,
              },
            ]}
            data={emails}
            onRowClick={handlePreview}
            emptyMessage="No emails recorded"
          />
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
