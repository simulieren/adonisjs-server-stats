import { extractAddresses } from '../utils/mail_helpers.js'

const MAX_HTML = 50_000

/**
 * Sensitive query-parameter names whose values are stripped from captured
 * URLs. These carry one-time login/reset/verify credentials.
 *
 * The name may carry a prefix (`reset_token=`, `resetToken=`, `id_token=`):
 * a bare `\b` boundary cannot see those, because `_` is a word character and
 * camelCase has no boundary at all. Over-matching a benign param that merely
 * ends in a keyword (`postcode=`) costs a little readability; missing
 * `reset_token=` costs a live credential.
 */
const SENSITIVE_QUERY_PARAMS =
  /[\w-]*(?:token|code|api_key|apikey|key|secret|signature|sig|password|pwd|auth|otp|nonce|state)=[^\s&"'<>]*/gi

/**
 * URL path segments that indicate a credential-bearing link even when the
 * secret is in the path rather than the query string (reset/verify/magic).
 */
const SENSITIVE_URL_PATHS =
  /(https?:\/\/[^\s"'<>]*?\/(?:reset|verify|verification|confirm|magic|magic-link|activate|invite|unsubscribe|(?:set-|new-)?password)[^\s"'<>]*)/gi

const SENSITIVE_PATH_MARKER =
  /\/(reset|verify|verification|confirm|magic|magic-link|activate|invite|unsubscribe|(?:set-|new-)?password)/i

/**
 * A long opaque path segment (24+ unhyphenated word chars) inside a URL —
 * the shape of a bare token in the path. Hyphens are excluded so ordinary
 * hyphenated slugs in newsletters survive.
 */
const OPAQUE_PATH_SEGMENT = /(https?:\/\/[^\s"'<>]*?\/)([A-Za-z0-9_]{24,})(?=[/?#"'\s<>&]|$)/g

/**
 * Redact token-bearing links from an email body before persistence.
 *
 * Conservative by design: strips values of known sensitive query params,
 * neutralizes reset/verify/magic-link URLs, and redacts long opaque tokens
 * that appear in URL path segments. Ordinary content is left untouched.
 */
export function redactTokenLinks(body: string): string {
  return (
    body
      // ?token=… / &reset_token=… → keep the key, drop the value
      .replace(SENSITIVE_QUERY_PARAMS, (m) => m.slice(0, m.indexOf('=') + 1) + '[redacted]')
      // reset/verify/magic URLs → redact everything after the sensitive segment
      .replace(SENSITIVE_URL_PATHS, (_m, url: string) => {
        const marker = url.search(SENSITIVE_PATH_MARKER)
        return marker === -1 ? url : url.slice(0, marker) + '/[redacted]'
      })
      // a bare token as a path segment → redact just that segment
      .replace(OPAQUE_PATH_SEGMENT, (_m, head: string) => head + '[redacted]')
  )
}

/**
 * Cap an HTML/text body to a maximum size, stripping token-bearing links first.
 * Returns `null` for falsy or non-string inputs.
 */
export function capHtmlSize(v: unknown, maxSize: number = MAX_HTML): string | null {
  if (!v || typeof v !== 'string') return null
  const cleaned = redactTokenLinks(v)
  if (cleaned.length <= maxSize) return cleaned
  return cleaned.slice(0, maxSize) + '\n<!-- truncated -->'
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
