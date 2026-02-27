import { extractAddresses } from '../utils/mail_helpers.js'
import { RingBuffer } from './ring_buffer.js'

import type { EmailRecord, Emitter, MailEventData, MailMessage } from './types.js'

/**
 * Listens to AdonisJS mail events and stores captured emails in a ring buffer.
 *
 * Events:
 * - `mail:sending` — email about to be sent
 * - `mail:sent` — email successfully sent (updates matching 'sending' record)
 * - `mail:queued` — email queued for later delivery
 * - `queued:mail:error` — queued email failed
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

    const onSending = (data: MailEventData) => {
      const msg: MailMessage = data?.message || data
      const record = this.buildRecord(msg, 'sending', data)
      this.buffer.push(record)
    }

    const onSent = (data: MailEventData) => {
      const msg: MailMessage = data?.message || data
      const to = extractAddresses(msg?.to)
      const subject = msg?.subject || ''

      // Try to find the matching 'sending' record and update it
      const all = this.buffer.toArray()
      for (let i = all.length - 1; i >= 0; i--) {
        const rec = all[i]
        if (rec.status === 'sending' && rec.to === to && rec.subject === subject) {
          rec.status = 'sent'
          rec.messageId = data?.response?.messageId || data?.messageId || null
          return
        }
      }

      // No matching 'sending' record — insert a new 'sent' record
      const record = this.buildRecord(msg, 'sent', data)
      record.messageId = data?.response?.messageId || data?.messageId || null
      this.buffer.push(record)
    }

    const onQueued = (data: MailEventData) => {
      const msg: MailMessage = data?.message || data
      const record = this.buildRecord(msg, 'queued', data)
      this.buffer.push(record)
    }

    const onQueuedError = (data: MailEventData) => {
      const msg: MailMessage = data?.message || data
      const record = this.buildRecord(msg, 'failed', data)
      this.buffer.push(record)
    }

    this.handlers = [
      { event: 'mail:sending', fn: onSending },
      { event: 'mail:sent', fn: onSent },
      { event: 'mail:queued', fn: onQueued },
      { event: 'queued:mail:error', fn: onQueuedError },
    ]

    for (const h of this.handlers) {
      emitter.on(h.event, h.fn)
    }
  }

  stop(): void {
    if (this.emitter && typeof this.emitter.off === 'function') {
      for (const h of this.handlers) {
        this.emitter.off(h.event, h.fn)
      }
    }
    this.handlers = []
    this.emitter = null
  }

  getEmails(): EmailRecord[] {
    return this.buffer.toArray()
  }

  getLatest(n: number = 100): EmailRecord[] {
    return this.buffer.latest(n)
  }

  getEmailHtml(id: number): string | null {
    const all = this.buffer.toArray()
    const record = all.find((r) => r.id === id)
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

  private buildRecord(
    msg: MailMessage,
    status: EmailRecord['status'],
    data: MailEventData
  ): EmailRecord {
    return {
      id: this.buffer.getNextId(),
      from: extractAddresses(msg?.from) || 'unknown',
      to: extractAddresses(msg?.to) || 'unknown',
      cc: extractAddresses(msg?.cc) || null,
      bcc: extractAddresses(msg?.bcc) || null,
      subject: msg?.subject || '(no subject)',
      html: msg?.html || null,
      text: msg?.text || null,
      mailer: data?.mailerName || data?.mailer || 'unknown',
      status,
      messageId: null,
      attachmentCount: Array.isArray(msg?.attachments) ? msg.attachments.length : 0,
      timestamp: Date.now(),
    }
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
