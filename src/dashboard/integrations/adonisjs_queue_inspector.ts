import type { ApplicationService } from '@adonisjs/core/types'
import type { QueueInspectorContract } from './queue_inspector_contract.js'
import type {
  QueueOverview,
  QueueJobDetail,
  QueueJobListResult,
  JobStatus,
} from './queue_inspector_contract.js'
import { resolveFromApplication } from './adonisjs_queue_store.js'
import type { QueueStoreReader } from './adonisjs_queue_store.js'

// ---------------------------------------------------------------------------
// AdonisQueueInspector
// ---------------------------------------------------------------------------

/**
 * Inspects @adonisjs/queue jobs via the shared store reader.
 *
 * Supports both the database (Lucid/Knex) and Redis drivers.
 * All methods catch errors and return safe defaults.
 */
export class AdonisQueueInspector implements QueueInspectorContract {
  #app: ApplicationService
  #readerPromise: Promise<QueueStoreReader | null> | null = null
  // Internal seam: override the resolver in tests for deterministic control.
  // Not part of the public constructor signature / exported types.
  declare _resolveReader: (app: ApplicationService) => Promise<QueueStoreReader | null>

  constructor(app: ApplicationService, ...args: unknown[]) {
    this.#app = app
    // Allow an optional second arg to inject a fake resolver in tests.
    if (typeof (args[0] as unknown) === 'function') {
      this._resolveReader = args[0] as (app: ApplicationService) => Promise<QueueStoreReader | null>
    } else {
      this._resolveReader = (a) => resolveFromApplication(a)
    }
  }

  /**
   * Detect whether `@adonisjs/queue` is registered in the application container.
   */
  static async isAvailable(app: ApplicationService): Promise<boolean> {
    try {
      await app.container.make('queue.manager')
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Lazily resolve and cache the store reader.
   *
   * Memoizes the *promise* (not a boolean flag) so concurrent callers —
   * e.g. `getOverview()` + `listJobs()` fired together via `Promise.all` —
   * all await the same in-flight resolution instead of racing on a half-set
   * flag and getting a still-null reader.
   */
  async #getReader(): Promise<QueueStoreReader | null> {
    if (!this.#readerPromise) {
      this.#readerPromise = this._resolveReader(this.#app)
    }
    return this.#readerPromise
  }

  // ---------------------------------------------------------------------------
  // QueueInspectorContract implementation
  // ---------------------------------------------------------------------------

  /**
   * Get an overview of job counts by status across all queues.
   * The @adonisjs/queue driver has no concept of paused queues, so `paused` is always 0.
   */
  async getOverview(): Promise<QueueOverview> {
    const defaults: QueueOverview = {
      active: 0,
      waiting: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
      paused: 0,
    }

    try {
      const reader = await this.#getReader()
      if (!reader) return defaults

      const counts = await reader.getCounts()
      return {
        active: counts.active,
        waiting: counts.waiting,
        delayed: counts.delayed,
        completed: counts.completed,
        failed: counts.failed,
        paused: 0,
      }
    } catch {
      return defaults
    }
  }

  /**
   * List jobs filtered by status with pagination.
   *
   * @param status   Job status to filter by, or `'all'` for every status.
   * @param page     Page number (1-based).
   * @param perPage  Jobs per page.
   */
  async listJobs(
    status: JobStatus | 'all' = 'all',
    page = 1,
    perPage = 25
  ): Promise<QueueJobListResult> {
    try {
      const reader = await this.#getReader()
      if (!reader) return { jobs: [], total: 0 }

      return await reader.listJobs(status === 'paused' ? 'all' : status, page, perPage)
    } catch {
      return { jobs: [], total: 0 }
    }
  }

  /**
   * Get full detail for a single job by ID.
   */
  async getJob(id: string): Promise<QueueJobDetail | null> {
    try {
      const reader = await this.#getReader()
      if (!reader) return null

      return await reader.getJob(id)
    } catch {
      return null
    }
  }

  /**
   * Retry a failed job.
   *
   * @returns `true` if the job was successfully requeued.
   */
  async retryJob(id: string): Promise<boolean> {
    try {
      const reader = await this.#getReader()
      if (!reader) return false

      return await reader.retryJob(id)
    } catch {
      return false
    }
  }
}
