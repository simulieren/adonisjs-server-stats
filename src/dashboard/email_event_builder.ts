/**
 * Pure function to build an EmailRecord from an AdonisJS mail event.
 *
 * Extracted from DashboardStore.wireEventListeners to reduce
 * cyclomatic complexity (the original had 28 due to many || chains).
 */

import { extractAddresses } from '../utils/mail_helpers.js'

import type { EmailRecord } from '../debug/types.js'

/**
 * Build an EmailRecord from raw event data emitted by AdonisJS mail events.
 *
 * Handles two shapes:
 * 1. Standard: `{ message: { from, to, ... }, mailerName, response }`
 * 2. Flat: `{ from, to, subject, ... }` (data IS the message)
 */
export function buildEmailRecordFromEvent(
  data: unknown,
  status: EmailRecord['status']
): EmailRecord {
  const d = (data ?? {}) as Record<string, unknown>
  const msg = extractMessage(d)

  return {
    from: extractAddresses(msg?.from) || 'unknown',
    to: extractAddresses(msg?.to) || 'unknown',
    cc: extractAddresses(msg?.cc) || null,
    bcc: extractAddresses(msg?.bcc) || null,
    subject: extractSubject(msg),
    html: extractString(msg?.html),
    text: extractString(msg?.text),
    mailer: extractMailer(d),
    status,
    messageId: extractMessageId(d),
    attachmentCount: countAttachments(msg),
    timestamp: Date.now(),
  } as EmailRecord
}

function extractMessage(d: Record<string, unknown>): Record<string, unknown> | undefined {
  return (d.message || d) as Record<string, unknown> | undefined
}

function extractSubject(msg: Record<string, unknown> | undefined): string {
  return (msg?.subject as string) || '(no subject)'
}

function extractString(value: unknown): string | null {
  return (value as string) || null
}

function extractMailer(d: Record<string, unknown>): string {
  return (d.mailerName as string) || (d.mailer as string) || 'unknown'
}

function extractMessageId(d: Record<string, unknown>): string | null {
  const fromResponse = (d.response as Record<string, unknown> | undefined)?.messageId as
    | string
    | undefined
  if (fromResponse) return fromResponse

  return (d.messageId as string) || null
}

function countAttachments(msg: Record<string, unknown> | undefined): number {
  if (!Array.isArray(msg?.attachments)) return 0
  return (msg.attachments as unknown[]).length
}
