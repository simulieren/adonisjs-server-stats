import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

let warnedLucidMissing = false
let warnedSessionsTable = false

/**
 * Queries application-specific tables for user sessions,
 * pending webhooks, and pending emails.
 *
 * Expects `sessions`, `webhook_events`, and `scheduled_emails` tables
 * to exist. Missing tables are silently ignored (returns 0).
 *
 * **Metrics produced:**
 * - `onlineUsers` -- active session count
 * - `pendingWebhooks` -- webhook events awaiting delivery
 * - `pendingEmails` -- scheduled emails awaiting send
 *
 * **Peer dependencies:** `@adonisjs/lucid`
 */
export function appCollector(): MetricCollector {
  return {
    name: 'app',
    label: 'app — users, webhooks, emails',

    async collect() {
      try {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        const [sessions, webhooks, emails] = await Promise.all([
          db
            .from('sessions')
            .count('* as total')
            .first()
            .then((r: { total?: number | string } | undefined) => Number(r?.total ?? 0))
            .catch(() => {
              if (!warnedSessionsTable) {
                warnedSessionsTable = true
                log.block(`${bold('sessions')} table not found`, [
                  dim('The app collector expects these tables to exist:'),
                  `  ${bold('sessions')}, ${bold('webhook_events')}, ${bold('scheduled_emails')}`,
                  dim('Missing tables are ignored (metrics default to 0).'),
                ])
              }
              return 0
            }),
          db
            .from('webhook_events')
            .where('status', 'pending')
            .count('* as total')
            .first()
            .then((r: { total?: number | string } | undefined) => Number(r?.total ?? 0))
            .catch(() => 0),
          db
            .from('scheduled_emails')
            .where('status', 'pending')
            .count('* as total')
            .first()
            .then((r: { total?: number | string } | undefined) => Number(r?.total ?? 0))
            .catch(() => 0),
        ])
        return {
          onlineUsers: sessions,
          pendingWebhooks: webhooks,
          pendingEmails: emails,
        }
      } catch {
        if (!warnedLucidMissing) {
          warnedLucidMissing = true
          log.block(`${bold('@adonisjs/lucid')} is not installed`, [
            dim('The app collector requires Lucid to query the database.'),
            dim('Install it with:'),
            `  ${bold('node ace add @adonisjs/lucid')}`,
            dim('Until then, app metrics will report 0.'),
          ])
        }
        return { onlineUsers: 0, pendingWebhooks: 0, pendingEmails: 0 }
      }
    },
  }
}
