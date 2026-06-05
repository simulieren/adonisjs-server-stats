import { log } from '../utils/logger.js'
import { CacheInspector } from './integrations/cache_inspector.js'
import { QueueInspector } from './integrations/queue_inspector.js'
import { AdonisQueueInspector } from './integrations/adonisjs_queue_inspector.js'

import type { ApplicationService } from '@adonisjs/core/types'
import type { QueueInspectorContract } from './integrations/queue_inspector_contract.js'

/**
 * Manages lazy initialization and availability detection for
 * cache (Redis) and queue (BullMQ / @adonisjs/queue) inspectors.
 *
 * Extracted from DashboardController to reduce file size and complexity.
 */
export class InspectorManager {
  private cacheInspector: CacheInspector | null = null
  private queueInspector: QueueInspectorContract | null = null
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

  /** Lazy-init the queue inspector. Returns null if neither BullMQ nor @adonisjs/queue is available. */
  async getQueueInspector(): Promise<QueueInspectorContract | null> {
    if (this.queueAvailable === false) return null
    if (this.queueInspector) return this.queueInspector

    try {
      // Try BullMQ (@rlanz/bull-queue) first.
      if (await QueueInspector.isAvailable(this.app)) {
        const queue = await this.app.container.make('rlanz/queue')
        this.queueInspector = new QueueInspector(queue)
        this.queueAvailable = true
        log.info('dashboard: BullMQ detected — Jobs panel enabled')
        return this.queueInspector
      }

      // Fall back to @adonisjs/queue.
      if (await AdonisQueueInspector.isAvailable(this.app)) {
        this.queueInspector = new AdonisQueueInspector(this.app)
        this.queueAvailable = true
        log.info('dashboard: @adonisjs/queue detected — Jobs panel enabled')
        return this.queueInspector
      }

      this.queueAvailable = false
      log.info('dashboard: Queue not detected — Jobs panel disabled')
      return null
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
