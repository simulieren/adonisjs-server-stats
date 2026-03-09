import React, { useState, useCallback, useEffect } from 'react'

import {
  resolveFromAddr,
  resolveToAddr,
  resolveCcAddr,
  resolveAttachmentCount,
  resolveTimestamp,
} from '../../../../core/field-resolvers.js'
import { TimeAgoCell } from '../../shared/TimeAgoCell.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { DataTable } from '../shared/DataTable.js'
import { FilterBar } from '../../shared/FilterBar.js'
import { EmailPreviewOverlay } from '../../shared/EmailPreviewOverlay.js'
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
    const previewData = email
      ? {
          subject: email.subject as string,
          from: resolveFromAddr(email),
          to: resolveToAddr(email),
          cc: resolveCcAddr(email) || null,
          status: email.status as string,
          mailer: email.mailer as string,
        }
      : null
    return (
      <EmailPreviewOverlay
        email={previewData}
        previewHtml={previewHtml}
        onClose={() => {
          setPreviewId(null)
          setPreviewHtml(null)
        }}
        className="ss-dash-email-preview"
      />
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
                    const from = resolveFromAddr(row)
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
                    const to = resolveToAddr(row)
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
                    const count = resolveAttachmentCount(row)
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
                    const ts = resolveTimestamp(row) as string
                    return (
                      <TimeAgoCell
                        ts={ts}
                        className="ss-dash-event-time"
                        style={{ whiteSpace: 'nowrap' }}
                      />
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
