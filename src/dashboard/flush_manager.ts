import { log } from '../utils/logger.js'
import {
  prepareRequestRows,
  prepareLogRows,
  flushRequests,
  flushEvents,
  flushEmails,
  flushLogs,
  hasWarned,
  markWarned,
} from './write_queue.js'

import type { EventRecord, EmailRecord } from '../debug/types.js'
import type { PersistRequestInput } from './dashboard_types.js'
import type { Knex } from 'knex'

const FLUSH_MS = 500
const MAX_Q = 200

export class FlushManager {
  writeQueue: PersistRequestInput[] = []
  pendingEvents: { requestIndex: number; events: EventRecord[] }[] = []
  pendingLogs: Record<string, unknown>[] = []
  pendingEmails: EmailRecord[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushing = false
  private db: () => Knex | null

  constructor(getDb: () => Knex | null) {
    this.db = getDb
  }

  persistRequest(input: PersistRequestInput, dashboardPath: string): void {
    if (!this.db() || input.url.startsWith(dashboardPath)) return
    this.backpressure(this.writeQueue)
    this.writeQueue.push(input)
    this.scheduleFlush()
  }

  queueEvents(requestIndex: number, events: EventRecord[]): void {
    if (events.length > 0) this.pendingEvents.push({ requestIndex, events })
  }

  recordLog(entry: Record<string, unknown>): void {
    if (!this.db()) return
    this.backpressure(this.pendingLogs)
    this.pendingLogs.push(entry)
    this.scheduleFlush()
  }

  recordEmail(record: EmailRecord): void {
    if (!this.db()) return
    this.backpressure(this.pendingEmails)
    this.pendingEmails.push(record)
    this.scheduleFlush()
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush().catch(() => {})
  }

  private backpressure(q: unknown[]): void {
    if (q.length >= MAX_Q) q.splice(0, Math.floor(MAX_Q / 4))
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush().catch((err) => {
        if (!hasWarned('flush')) {
          markWarned('flush')
          log.warn(`dashboard: flush failed — ${(err as Error)?.message}`)
        }
      })
    }, FLUSH_MS)
  }

  async flush(): Promise<void> {
    const db = this.db()
    if (this.flushing || !db) return
    this.flushing = true
    const snap = this.takeSnapshot()
    if (!snap) {
      this.flushing = false
      return
    }
    try {
      const pr = prepareRequestRows(snap.requests)
      const pl = prepareLogRows(snap.logs)
      await db.transaction(async (trx) => {
        await flushRequests(trx, pr)
        await flushEvents(trx, snap.events)
        await flushEmails(trx, snap.emails)
        await flushLogs(trx, pl)
      })
    } catch (err) {
      if (!hasWarned('flush')) {
        markWarned('flush')
        log.warn(`dashboard: flush transaction failed — ${(err as Error)?.message}`)
      }
    } finally {
      this.flushing = false
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (this.writeQueue.length > 0 || this.pendingLogs.length > 0 || this.pendingEmails.length > 0)
      this.scheduleFlush()
  }

  private takeSnapshot() {
    const requests = this.writeQueue.splice(0)
    const logs = this.pendingLogs.splice(0)
    const events = this.pendingEvents.splice(0)
    const emails = this.pendingEmails.splice(0)
    if (requests.length === 0 && logs.length === 0 && events.length === 0 && emails.length === 0)
      return null
    return { requests, logs, events, emails }
  }
}
