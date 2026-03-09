import React from 'react'

/**
 * Shared email preview overlay used by both Dashboard EmailsSection
 * and DebugPanel EmailsTab.
 *
 * Uses the neutral `ss-email-*` CSS classes from `components.css`.
 */

export interface EmailPreviewData {
  subject?: string | null
  from?: string | null
  to?: string | null
  cc?: string | null
  status?: string | null
  mailer?: string | null
  text?: string | null
}

export interface EmailPreviewOverlayProps {
  /** Email metadata to display in the header. */
  email: EmailPreviewData | null
  /** The HTML string to render in the preview iframe, or `null`. */
  previewHtml: string | null
  /** Whether the preview HTML is still loading. */
  isLoading?: boolean
  /** Callback to close the preview overlay. */
  onClose: () => void
  /** Optional CSS class name for the root container (allows context-specific overrides). */
  className?: string
}

export function EmailPreviewOverlay({
  email,
  previewHtml,
  isLoading = false,
  onClose,
  className,
}: EmailPreviewOverlayProps) {
  return (
    <div className={className || 'ss-email-preview'}>
      <div className="ss-email-preview-header">
        <div className="ss-email-preview-meta">
          {email && (
            <>
              {email.subject != null && (
                <div>
                  <strong>Subject:</strong> {email.subject}
                </div>
              )}
              {email.from != null && (
                <div>
                  <strong>From:</strong> {email.from}
                </div>
              )}
              {email.to != null && (
                <div>
                  <strong>To:</strong> {email.to}
                </div>
              )}
              {email.cc && (
                <div>
                  <strong>CC:</strong> {email.cc}
                </div>
              )}
              {email.status && (
                <div>
                  <strong>Status:</strong>{' '}
                  <span className={`ss-email-status ss-email-status-${email.status}`}>
                    {email.status}
                  </span>
                </div>
              )}
              {email.mailer && (
                <div>
                  <strong>Mailer:</strong> {email.mailer}
                </div>
              )}
            </>
          )}
        </div>
        <button className="ss-dbg-btn-clear" onClick={onClose} type="button">
          {'\u00D7'}
        </button>
      </div>
      {isLoading ? (
        <div className="ss-empty">Loading preview...</div>
      ) : previewHtml ? (
        <iframe
          className="ss-email-iframe"
          srcDoc={previewHtml}
          title="Email preview"
          sandbox=""
        />
      ) : (
        <div style={{ padding: '12px', whiteSpace: 'pre-wrap' }}>
          {email?.text || 'No content'}
        </div>
      )}
    </div>
  )
}

export default EmailPreviewOverlay
