import { extractAddresses } from '../utils/mail_helpers.js'
import { RingBuffer } from './ring_buffer.js'

import type { EmailRecord, Emitter, MailEventData, MailMessage } from './types.js'

const MAX_HTML_SIZE = 50_000

/** Extract the message object from the event data. */
function extractMessage(data: MailEventData): MailMessage {
  return data?.message || data
}

/** Extract message ID from event data. */
function extractMessageId(data: MailEventData): string | null {
  return data?.response?.messageId || data?.messageId || null
}

/** Truncate large HTML/text bodies to prevent memory bloat. */
function capSize(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.length <= MAX_HTML_SIZE) return value
  return value.slice(0, MAX_HTML_SIZE) + '\n<!-- truncated -->'
}

/** Resolve an address field to a string, defaulting when empty. */
function resolveAddress(field: unknown, fallback: string | null): string | null {
  return extractAddresses(field) || fallback
}

/** Resolve the mailer name from event data. */
function resolveMailer(data: MailEventData): string {
  return data?.mailerName || data?.mailer || 'unknown'
}

/** Count attachments safely. */
function countAttachments(msg: MailMessage): number {
  return Array.isArray(msg?.attachments) ? msg.attachments.length : 0
}

/** Build the core fields of an email record from a mail message. */
function buildRecordFields(
  msg: MailMessage,
  data: MailEventData
): Omit<EmailRecord, 'id' | 'status' | 'messageId' | 'timestamp'> {
  return {
    from: resolveAddress(msg?.from, 'unknown') as string,
    to: resolveAddress(msg?.to, 'unknown') as string,
    cc: resolveAddress(msg?.cc, null),
    bcc: resolveAddress(msg?.bcc, null),
    subject: msg?.subject || '(no subject)',
    html: capSize(msg?.html),
    text: capSize(msg?.text),
    mailer: resolveMailer(data),
    attachmentCount: countAttachments(msg),
  }
}

/**
 * Listens to AdonisJS mail events and stores captured emails in a ring buffer.
 */
export class EmailCollector {
  private buffer: RingBuffer<EmailRecord>
  private emitter: Emitter | null = null
  private handlers: { event: string; fn: (data: MailEventData) => void }[] = []

  constructor(maxEmails: number = 100) {
    this.buffer = new RingBuffer<EmailRecord>(maxEmails)
  }

  async start(emitter: Emitter): Promise<void> {
    if (!emitter || typeof emitter.on !== 'function') return
    this.emitter = emitter

    this.handlers = [
      { event: 'mail:sending', fn: (data) => this.#onSimpleEvent(data, 'sending') },
      { event: 'mail:sent', fn: (data) => this.#onTransitionEvent(data, 'sending', 'sent') },
      { event: 'mail:queueing', fn: (data) => this.#onSimpleEvent(data, 'queueing') },
      { event: 'mail:queued', fn: (data) => this.#onTransitionEvent(data, 'queueing', 'queued') },
      { event: 'queued:mail:error', fn: (data) => this.#onSimpleEvent(data, 'failed') },
    ]

    for (const h of this.handlers) {
      emitter.on(h.event, h.fn as (...args: unknown[]) => void)
    }
  }

  /** Handle events that simply push a new record. */
  #onSimpleEvent(data: MailEventData, status: EmailRecord['status']): void {
    const msg = extractMessage(data)
    const record = this.#buildRecord(msg, status, data)
    this.buffer.push(record)
  }

  /** Handle events that update an existing record or create a new one. */
  #onTransitionEvent(
    data: MailEventData,
    fromStatus: EmailRecord['status'],
    toStatus: EmailRecord['status']
  ): void {
    const msg = extractMessage(data)
    const to = extractAddresses(msg?.to)
    const subject = msg?.subject || ''

    const match = this.buffer.findFromEnd(
      (rec) => rec.status === fromStatus && rec.to === to && rec.subject === subject
    )
    if (match) {
      match.status = toStatus
      match.messageId = extractMessageId(data)
      return
    }

    const record = this.#buildRecord(msg, toStatus, data)
    record.messageId = extractMessageId(data)
    this.buffer.push(record)
  }

  #buildRecord(msg: MailMessage, status: EmailRecord['status'], data: MailEventData): EmailRecord {
    return {
      id: this.buffer.getNextId(),
      ...buildRecordFields(msg, data),
      status,
      messageId: null,
      timestamp: Date.now(),
    }
  }

  stop(): void {
    if (this.emitter && typeof this.emitter.off === 'function') {
      for (const h of this.handlers) {
        this.emitter.off(h.event, h.fn as (...args: unknown[]) => void)
      }
    }
    this.handlers = []
    this.emitter = null
  }

  getEmails(): EmailRecord[] {
    return this.buffer.toArray().reverse()
  }

  getLatest(n: number = 100): EmailRecord[] {
    return this.buffer.latest(n)
  }

  getEmailHtml(id: number): string | null {
    const record = this.buffer.findFromEnd((r) => r.id === id)
    return record?.html ?? null
  }

  getTotalCount(): number {
    return this.buffer.size()
  }

  getBufferInfo(): { current: number; max: number } {
    return { current: this.buffer.size(), max: this.buffer.getCapacity() }
  }

  clear(): void {
    this.buffer.clear()
  }

  /**
   * Push an externally-created email record into the buffer.
   *
   * Used by the Redis email bridge to ingest emails captured in
   * other processes (e.g., queue workers). The caller provides all
   * fields except `id`, which is assigned from the ring buffer's
   * auto-increment counter.
   */
  ingest(partial: Omit<EmailRecord, 'id'>): void {
    const record: EmailRecord = {
      ...partial,
      id: this.buffer.getNextId(),
    }
    this.buffer.push(record)
  }

  /** Register a callback that fires whenever a new email is recorded. */
  onNewItem(cb: ((item: EmailRecord) => void) | null): void {
    this.buffer.onPush(cb)
  }

  /** Restore persisted records into the buffer and reset the ID counter. */
  loadRecords(records: EmailRecord[]): void {
    this.buffer.load(records)
    const maxId = records.reduce((m, r) => Math.max(m, r.id), 0)
    this.buffer.setNextId(maxId + 1)
  }
}
