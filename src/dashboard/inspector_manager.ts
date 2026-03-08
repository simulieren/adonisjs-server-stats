import { log } from '../utils/logger.js'
import { CacheInspector } from './integrations/cache_inspector.js'
import { QueueInspector } from './integrations/queue_inspector.js'

import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Manages lazy initialization and availability detection for
 * cache (Redis) and queue (BullMQ) inspectors.
 *
 * Extracted from DashboardController to reduce file size and complexity.
 */
export class InspectorManager {
  private cacheInspector: CacheInspector | null = null
  private queueInspector: QueueInspector | null = null
  private cacheAvailable: boolean | null = null
  private queueAvailable: boolean | null = null

  constructor(private app: ApplicationService) {}

  /** Lazy-init the cache inspector. Returns null if Redis is unavailable. */
  async getCacheInspector(): Promise<CacheInspector | null> {
    if (this.cacheAvailable === false) return null
    if (this.cacheInspector) return this.cacheInspector

    try {
      const available = await CacheInspector.isAvailable(this.app)
      this.cacheAvailable = available
      if (!available) {
        log.info('dashboard: Redis not detected — Cache panel disabled')
        return null
      }

      const redis = await this.app.container.make('redis')
      this.cacheInspector = new CacheInspector(redis)
      return this.cacheInspector
    } catch (err) {
      this.cacheAvailable = false
      log.warn('dashboard: CacheInspector init failed — ' + (err as Error)?.message)
      return null
    }
  }

  /** Lazy-init the queue inspector. Returns null if BullMQ is unavailable. */
  async getQueueInspector(): Promise<QueueInspector | null> {
    if (this.queueAvailable === false) return null
    if (this.queueInspector) return this.queueInspector

    try {
      const available = await QueueInspector.isAvailable(this.app)
      this.queueAvailable = available
      if (!available) {
        log.info('dashboard: Queue not detected — Jobs panel disabled')
        return null
      }

      const queue = await this.app.container.make('rlanz/queue')
      this.queueInspector = new QueueInspector(queue)
      return this.queueInspector
    } catch (err) {
      this.queueAvailable = false
      log.warn('dashboard: QueueInspector init failed — ' + (err as Error)?.message)
      return null
    }
  }

  /** Fetch cache overview stats for the overview page. */
  async fetchCacheOverview() {
    try {
      const inspector = await this.getCacheInspector()
      if (!inspector) return null

      const stats = await inspector.getStats()
      return {
        available: true,
        totalKeys: stats.totalKeys,
        hitRate: stats.hitRate,
        memoryUsedHuman: stats.memoryUsedHuman,
      }
    } catch {
      return null
    }
  }

  /** Fetch queue overview stats for the overview page. */
  async fetchQueueOverview() {
    try {
      const inspector = await this.getQueueInspector()
      if (!inspector) return null

      const overview = await inspector.getOverview()
      return {
        available: true,
        active: overview.active,
        waiting: overview.waiting,
        failed: overview.failed,
        completed: overview.completed,
      }
    } catch {
      return null
    }
  }
}
