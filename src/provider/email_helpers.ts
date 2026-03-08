import { extractAddresses } from '../utils/mail_helpers.js'

const MAX_HTML = 50_000

/**
 * Cap an HTML/text body to a maximum size.
 * Returns `null` for falsy or non-string inputs.
 */
export function capHtmlSize(v: unknown, maxSize: number = MAX_HTML): string | null {
  if (!v || typeof v !== 'string') return null
  if (v.length <= maxSize) return v
  return v.slice(0, maxSize) + '\n<!-- truncated -->'
}

/**
 * Mapping of AdonisJS mail events to their corresponding status strings.
 */
export const MAIL_STATUS_MAP: Array<[string, string]> = [
  ['mail:sending', 'sending'],
  ['mail:sent', 'sent'],
  ['mail:queueing', 'queueing'],
  ['mail:queued', 'queued'],
  ['queued:mail:error', 'failed'],
]

function extractMessage(data: Record<string, unknown>): Record<string, unknown> {
  return ((data?.message || data) ?? {}) as Record<string, unknown>
}

function extractMailer(data: Record<string, unknown>): string {
  return (data?.mailerName as string) || (data?.mailer as string) || 'unknown'
}

function extractMessageId(data: Record<string, unknown>): string | null {
  const response = data?.response as Record<string, unknown> | undefined
  return (response?.messageId as string) || (data?.messageId as string) || null
}

function addressOrDefault(value: unknown, fallback: string): string {
  return extractAddresses(value) || fallback
}

function extractAddressFields(msg: Record<string, unknown>) {
  return {
    from: addressOrDefault(msg?.from, 'unknown'),
    to: addressOrDefault(msg?.to, 'unknown'),
    cc: extractAddresses(msg?.cc) || null,
    bcc: extractAddresses(msg?.bcc) || null,
  }
}

function extractContentFields(msg: Record<string, unknown>) {
  return {
    subject: (msg?.subject as string) || '(no subject)',
    html: capHtmlSize(msg?.html),
    text: capHtmlSize(msg?.text),
    attachmentCount: Array.isArray(msg?.attachments) ? msg.attachments.length : 0,
  }
}

/**
 * Build a serializable email payload from a mail event.
 */
export function buildEmailPayload(
  data: unknown,
  status: string,
  processTag: string
): Record<string, unknown> {
  const d = (data ?? {}) as Record<string, unknown>
  const msg = extractMessage(d)
  return {
    _t: processTag,
    ...extractAddressFields(msg),
    ...extractContentFields(msg),
    mailer: extractMailer(d),
    status,
    messageId: extractMessageId(d),
    timestamp: Date.now(),
  }
}
