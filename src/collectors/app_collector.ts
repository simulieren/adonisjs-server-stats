import type { MetricCollector } from './collector.js'

export function appCollector(): MetricCollector {
  return {
    name: 'app',

    async collect() {
      try {
        const { default: db } = await import('@adonisjs/lucid/services/db')

        const [sessions, webhooks, emails] = await Promise.all([
          db
            .from('sessions')
            .count('* as total')
            .first()
            .then((r: any) => Number(r?.total ?? 0)),
          db
            .from('webhook_events')
            .where('status', 'pending')
            .count('* as total')
            .first()
            .then((r: any) => Number(r?.total ?? 0))
            .catch(() => 0),
          db
            .from('scheduled_emails')
            .where('status', 'pending')
            .count('* as total')
            .first()
            .then((r: any) => Number(r?.total ?? 0))
            .catch(() => 0),
        ])
        return {
          onlineUsers: sessions,
          pendingWebhooks: webhooks,
          pendingEmails: emails,
        }
      } catch {
        return { onlineUsers: 0, pendingWebhooks: 0, pendingEmails: 0 }
      }
    },
  }
}
