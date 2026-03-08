import { appImport } from '../utils/app_import.js'
import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

let warnedLucidMissing = false
let warnedSessionsTable = false

/** Safely count rows from a table, returning 0 on error. */
async function safeTableCount(
  db: { from(table: string): unknown },
  table: string,
  where?: { column: string; value: string }
): Promise<number> {
  try {
    let query = (
      db as {
        from(t: string): {
          where(c: string, v: string): unknown
          count(c: string): { first(): Promise<{ total?: number | string } | undefined> }
        }
      }
    ).from(table)
    if (where) {
      query = (query as { where(c: string, v: string): typeof query }).where(
        where.column,
        where.value
      ) as typeof query
    }
    const row = await (
      query as { count(c: string): { first(): Promise<{ total?: number | string } | undefined> } }
    )
      .count('* as total')
      .first()
    return Number(row?.total ?? 0)
  } catch {
    return 0
  }
}

/** Count sessions with a one-time warning on missing table. */
async function countSessions(db: { from(table: string): unknown }): Promise<number> {
  const count = await safeTableCount(db, 'sessions')
  if (count === 0 && !warnedSessionsTable) {
    warnedSessionsTable = true
    log.block(`${bold('sessions')} table not found`, [
      dim('The app collector expects these tables to exist:'),
      `  ${bold('sessions')}, ${bold('webhook_events')}, ${bold('scheduled_emails')}`,
      dim('Missing tables are ignored (metrics default to 0).'),
    ])
  }
  return count
}

function warnLucidMissing(): void {
  if (warnedLucidMissing) return
  warnedLucidMissing = true
  log.block(`${bold('@adonisjs/lucid')} is not installed`, [
    dim('The app collector requires Lucid to query the database.'),
    dim('Install it with:'),
    `  ${bold('node ace add @adonisjs/lucid')}`,
    dim('Until then, app metrics will report 0.'),
  ])
}

/**
 * Queries application-specific tables for user sessions,
 * pending webhooks, and pending emails.
 *
 * **Peer dependencies:** `@adonisjs/lucid`
 */
export function appCollector(): MetricCollector {
  return {
    name: 'app',
    label: 'app — users, webhooks, emails',

    getConfig() {
      return {}
    },

    async collect() {
      try {
        const { default: db } = await appImport<typeof import('@adonisjs/lucid/services/db')>(
          '@adonisjs/lucid/services/db'
        )

        const [sessions, webhooks, emails] = await Promise.all([
          countSessions(db),
          safeTableCount(db, 'webhook_events', { column: 'status', value: 'pending' }),
          safeTableCount(db, 'scheduled_emails', { column: 'status', value: 'pending' }),
        ])
        return { onlineUsers: sessions, pendingWebhooks: webhooks, pendingEmails: emails }
      } catch {
        warnLucidMissing()
        return { onlineUsers: 0, pendingWebhooks: 0, pendingEmails: 0 }
      }
    },
  }
}
