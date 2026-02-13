import { configProvider } from '@adonisjs/core'

import type { ConfigProvider } from '@adonisjs/core/types'
import type { ServerStats } from '../types.js'

export function serverStatsCollector(): ConfigProvider<any> {
  return configProvider.create(async (app) => {
    const config = app.config.get<any>('prometheus', {})

    // Lazy import the Collector base class
    const { Collector } = await import('@julr/adonisjs-prometheus/collectors/collector')

    class ServerStatsCollectorImpl extends Collector {
      static instance: ServerStatsCollectorImpl | null = null

      // Process
      private cpuPercent!: any
      private eventLoopLag!: any

      // DB Pool
      private dbPoolUsed!: any
      private dbPoolFree!: any
      private dbPoolPending!: any
      private dbPoolMax!: any

      // Redis
      private redisUp!: any
      private redisMemoryUsedMb!: any
      private redisConnectedClients!: any
      private redisKeysCount!: any
      private redisHitRatePercent!: any

      // Queue
      private queueActiveJobs!: any
      private queueWaitingJobs!: any
      private queueDelayedJobs!: any
      private queueFailedJobs!: any
      private queueWorkerCount!: any

      // System
      private systemLoadAvg!: any
      private systemMemoryUsedMb!: any
      private systemMemoryTotalMb!: any

      // App
      private appOnlineUsers!: any
      private appPendingWebhooks!: any
      private appPendingEmails!: any

      register() {
        ServerStatsCollectorImpl.instance = this
        ServerStatsCollector.instance = this as any

        this.#registerProcessGauges()
        this.#registerDbPoolGauges()
        this.#registerRedisGauges()
        this.#registerQueueGauges()
        this.#registerSystemGauges()
        this.#registerAppGauges()
      }

      #registerProcessGauges() {
        this.cpuPercent = this.createGauge({
          name: this.buildMetricName('nodejs_cpu_usage_percent'),
          help: 'Node.js CPU usage percentage',
        })
        this.eventLoopLag = this.createGauge({
          name: this.buildMetricName('nodejs_event_loop_lag_ms'),
          help: 'Node.js event loop lag in milliseconds',
        })
      }

      #registerDbPoolGauges() {
        this.dbPoolUsed = this.createGauge({
          name: this.buildMetricName('db_pool_used'),
          help: 'Number of used database pool connections',
        })
        this.dbPoolFree = this.createGauge({
          name: this.buildMetricName('db_pool_free'),
          help: 'Number of free database pool connections',
        })
        this.dbPoolPending = this.createGauge({
          name: this.buildMetricName('db_pool_pending'),
          help: 'Number of pending database pool acquire requests',
        })
        this.dbPoolMax = this.createGauge({
          name: this.buildMetricName('db_pool_max'),
          help: 'Maximum database pool size',
        })
      }

      #registerRedisGauges() {
        this.redisUp = this.createGauge({
          name: this.buildMetricName('redis_up'),
          help: 'Whether Redis is reachable (0 or 1)',
        })
        this.redisMemoryUsedMb = this.createGauge({
          name: this.buildMetricName('redis_memory_used_mb'),
          help: 'Redis memory usage in megabytes',
        })
        this.redisConnectedClients = this.createGauge({
          name: this.buildMetricName('redis_connected_clients'),
          help: 'Number of connected Redis clients',
        })
        this.redisKeysCount = this.createGauge({
          name: this.buildMetricName('redis_keys_count'),
          help: 'Total number of Redis keys',
        })
        this.redisHitRatePercent = this.createGauge({
          name: this.buildMetricName('redis_hit_rate_percent'),
          help: 'Redis cache hit rate percentage',
        })
      }

      #registerQueueGauges() {
        this.queueActiveJobs = this.createGauge({
          name: this.buildMetricName('queue_active_jobs'),
          help: 'Number of active queue jobs',
        })
        this.queueWaitingJobs = this.createGauge({
          name: this.buildMetricName('queue_waiting_jobs'),
          help: 'Number of waiting queue jobs',
        })
        this.queueDelayedJobs = this.createGauge({
          name: this.buildMetricName('queue_delayed_jobs'),
          help: 'Number of delayed queue jobs',
        })
        this.queueFailedJobs = this.createGauge({
          name: this.buildMetricName('queue_failed_jobs'),
          help: 'Number of failed queue jobs',
        })
        this.queueWorkerCount = this.createGauge({
          name: this.buildMetricName('queue_worker_count'),
          help: 'Number of active queue workers',
        })
      }

      #registerSystemGauges() {
        this.systemLoadAvg = this.createGauge({
          name: this.buildMetricName('system_load_avg'),
          help: 'System load average',
          labelNames: ['period'],
        })
        this.systemMemoryUsedMb = this.createGauge({
          name: this.buildMetricName('system_memory_used_mb'),
          help: 'System memory used in megabytes',
        })
        this.systemMemoryTotalMb = this.createGauge({
          name: this.buildMetricName('system_memory_total_mb'),
          help: 'System total memory in megabytes',
        })
      }

      #registerAppGauges() {
        this.appOnlineUsers = this.createGauge({
          name: this.buildMetricName('app_online_users'),
          help: 'Number of online users (active sessions)',
        })
        this.appPendingWebhooks = this.createGauge({
          name: this.buildMetricName('app_pending_webhooks'),
          help: 'Number of pending webhook events',
        })
        this.appPendingEmails = this.createGauge({
          name: this.buildMetricName('app_pending_emails'),
          help: 'Number of pending scheduled emails',
        })
      }

      update(stats: Partial<ServerStats>) {
        if (stats.cpuPercent !== undefined) this.cpuPercent.set(stats.cpuPercent)
        if (stats.eventLoopLag !== undefined) this.eventLoopLag.set(stats.eventLoopLag)

        if (stats.dbPoolUsed !== undefined) this.dbPoolUsed.set(stats.dbPoolUsed)
        if (stats.dbPoolFree !== undefined) this.dbPoolFree.set(stats.dbPoolFree)
        if (stats.dbPoolPending !== undefined) this.dbPoolPending.set(stats.dbPoolPending)
        if (stats.dbPoolMax !== undefined) this.dbPoolMax.set(stats.dbPoolMax)

        if (stats.redisOk !== undefined) this.redisUp.set(stats.redisOk ? 1 : 0)
        if (stats.redisMemoryUsedMb !== undefined) this.redisMemoryUsedMb.set(stats.redisMemoryUsedMb)
        if (stats.redisConnectedClients !== undefined)
          this.redisConnectedClients.set(stats.redisConnectedClients)
        if (stats.redisKeysCount !== undefined) this.redisKeysCount.set(stats.redisKeysCount)
        if (stats.redisHitRate !== undefined) this.redisHitRatePercent.set(stats.redisHitRate)

        if (stats.queueActive !== undefined) this.queueActiveJobs.set(stats.queueActive)
        if (stats.queueWaiting !== undefined) this.queueWaitingJobs.set(stats.queueWaiting)
        if (stats.queueDelayed !== undefined) this.queueDelayedJobs.set(stats.queueDelayed)
        if (stats.queueFailed !== undefined) this.queueFailedJobs.set(stats.queueFailed)
        if (stats.queueWorkerCount !== undefined) this.queueWorkerCount.set(stats.queueWorkerCount)

        if (stats.systemLoadAvg1m !== undefined)
          this.systemLoadAvg.set({ period: '1m' }, stats.systemLoadAvg1m)
        if (stats.systemLoadAvg5m !== undefined)
          this.systemLoadAvg.set({ period: '5m' }, stats.systemLoadAvg5m)
        if (stats.systemLoadAvg15m !== undefined)
          this.systemLoadAvg.set({ period: '15m' }, stats.systemLoadAvg15m)
        if (stats.systemMemoryTotalMb !== undefined && stats.systemMemoryFreeMb !== undefined)
          this.systemMemoryUsedMb.set(stats.systemMemoryTotalMb - stats.systemMemoryFreeMb)
        if (stats.systemMemoryTotalMb !== undefined)
          this.systemMemoryTotalMb.set(stats.systemMemoryTotalMb)

        if (stats.onlineUsers !== undefined) this.appOnlineUsers.set(stats.onlineUsers)
        if (stats.pendingWebhooks !== undefined) this.appPendingWebhooks.set(stats.pendingWebhooks)
        if (stats.pendingEmails !== undefined) this.appPendingEmails.set(stats.pendingEmails)
      }
    }

    return new ServerStatsCollectorImpl(config)
  })
}

export const ServerStatsCollector: { instance: { update(stats: Partial<ServerStats>): void } | null } = {
  instance: null,
}
