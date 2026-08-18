import type { ApplicationService } from '@adonisjs/core/types'
import type { QueueInspectorContract } from './queue_inspector_contract.js'

// Re-export shared types so existing importers (including adonisjs_queue_store.ts)
// resolve without changes.
export type {
  QueueOverview,
  QueueJobSummary,
  QueueJobDetail,
  QueueJobListResult,
  JobStatus,
} from './queue_inspector_contract.js'
export { ALL_STATUSES } from './queue_inspector_contract.js'

// Pull types and values into local scope for use within this file.
import type {
  QueueOverview,
  QueueJobSummary,
  QueueJobDetail,
  QueueJobListResult,
  JobStatus,
} from './queue_inspector_contract.js'
import { ALL_STATUSES } from './queue_inspector_contract.js'

// ---------------------------------------------------------------------------
// Minimal interfaces for BullMQ types
// ---------------------------------------------------------------------------

/** Minimal interface for a BullMQ Job as accessed by the inspector. */
interface BullMQJob {
  id: string | number
  name: string
  data: Record<string, unknown> | null
  opts: Record<string, unknown>
  timestamp: number
  processedOn: number | null
  finishedOn: number | null
  failedReason: string | null
  stacktrace: string[]
  returnvalue: unknown
  attemptsMade: number
  progress: number | object
  delay?: number
  getState(): Promise<string>
  retry(): Promise<void>
}

/** Minimal interface for a BullMQ Queue as accessed by the inspector. */
interface BullMQQueue {
  getJobCounts(...statuses: string[]): Promise<Record<string, number>>
  getJobs(statuses: string[], start: number, end: number): Promise<(BullMQJob | null)[]>
  getJob(id: string): Promise<BullMQJob | null>
}

/** Minimal interface for the @rlanz/bull-queue manager. */
interface QueueManager {
  get?(name: string): BullMQQueue | null
  getOrSet?(name: string): BullMQQueue
  getJobCounts?(...statuses: string[]): Promise<Record<string, number>>
}

// ---------------------------------------------------------------------------
// QueueInspector
// ---------------------------------------------------------------------------

/**
 * Inspects Bull Queue jobs, counts, and allows retrying failed jobs.
 *
 * Designed for the full-page dashboard's Jobs section.
 * Only functional when `@rlanz/bull-queue` is installed.
 * All methods catch errors and return safe defaults.
 */
export class QueueInspector implements QueueInspectorContract {
  constructor(private queueManager: QueueManager) {}

  /**
   * Detect whether `@rlanz/bull-queue` is available in the application container.
   */
  static async isAvailable(app: ApplicationService): Promise<boolean> {
    try {
      await app.container.make('rlanz/queue')
      return true
    } catch {
      return false
    }
  }

  /**
   * Get an overview of job counts by status across all queues.
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
      const queue = this.getQueue()
      if (!queue) return defaults

      const counts = await queue.getJobCounts(
        'active',
        'waiting',
        'delayed',
        'completed',
        'failed',
        'paused'
      )

      return {
        active: counts.active ?? 0,
        waiting: counts.waiting ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        paused: counts.paused ?? 0,
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
      const queue = this.getQueue()
      if (!queue) return { jobs: [], total: 0 }

      const start = (page - 1) * perPage
      const end = start + perPage - 1

      const statuses: JobStatus[] = status === 'all' ? ALL_STATUSES : [status]

      const [rawJobs, counts] = await Promise.all([
        queue.getJobs(statuses, start, end) as Promise<(BullMQJob | null)[]>,
        queue.getJobCounts(...ALL_STATUSES) as Promise<Record<string, number>>,
      ])

      const jobs: QueueJobSummary[] = (rawJobs ?? [])
        .filter((job: BullMQJob | null): job is BullMQJob => job !== null && job !== undefined)
        .map((job: BullMQJob) => {
          const jobState = this.inferStatus(job) ?? (status === 'all' ? 'completed' : status)
          return this.formatJobSummary(job, jobState)
        })

      // Sort by creation time descending (newest first)
      jobs.sort((a, b) => b.createdAt - a.createdAt)

      const total =
        status === 'all'
          ? ALL_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0)
          : (counts[status] ?? 0)

      return { jobs, total }
    } catch {
      return { jobs: [], total: 0 }
    }
  }

  /**
   * Get full detail for a single job by ID.
   */
  async getJob(id: string): Promise<QueueJobDetail | null> {
    try {
      const queue = this.getQueue()
      if (!queue) return null

      const job = await queue.getJob(id)
      if (!job) return null

      const state = (await job.getState()) as JobStatus

      return {
        ...this.formatJobSummary(job, state),
        stackTrace: job.stacktrace ?? [],
        returnValue: job.returnvalue ?? null,
        opts: job.opts ?? {},
      }
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
      const queue = this.getQueue()
      if (!queue) return false

      const job = await queue.getJob(id)
      if (!job) return false

      const state = await job.getState()
      if (state !== 'failed') return false

      await job.retry()
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the underlying BullMQ Queue instance from the queue manager.
   *
   * `@rlanz/bull-queue` exposes queues via `.get(name)` or `.getOrSet(name)`.
   */
  private getQueue(): BullMQQueue | null {
    try {
      // @rlanz/bull-queue: .get(name) returns the BullMQ Queue instance
      if (typeof this.queueManager.get === 'function') {
        return this.queueManager.get('default') ?? null
      }

      // Fallback: .getOrSet(name) lazily creates the queue if needed
      if (typeof this.queueManager.getOrSet === 'function') {
        return this.queueManager.getOrSet('default')
      }

      // Last resort: the manager itself is already a Queue instance
      if (typeof this.queueManager.getJobCounts === 'function') {
        return this.queueManager as unknown as BullMQQueue
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Infer a job's status from its internal fields (avoids async getState() call).
   */
  private inferStatus(job: BullMQJob): JobStatus | null {
    if (job.failedReason || job.stacktrace?.length) return 'failed'
    if (job.finishedOn) return 'completed'
    if (job.processedOn) return 'active'
    if (job.delay && job.delay > 0 && !job.processedOn) return 'delayed'
    return null
  }

  /**
   * Extract a human-readable job name from a raw Bull job name.
   *
   * `@rlanz/bull-queue` often stores the full file URL as the job name
   * (e.g. `file:///Users/…/app/jobs/send_email.ts`). We extract just
   * the class-style name from the filename.
   */
  private static cleanJobName(raw: string): string {
    if (!raw || raw === '__default__') return 'default'

    // Strip file:// URLs down to the filename
    if (raw.startsWith('file://') || raw.startsWith('/')) {
      const filename = raw.split('/').pop() ?? raw
      // Remove extension and convert snake_case/kebab-case to PascalCase
      const base = filename.replace(/\.(ts|js|mjs|cjs)$/, '')
      return base
        .split(/[-_]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('')
    }

    return raw
  }

  /** Extract timing fields from a BullMQ job. */
  private static extractTimings(job: BullMQJob) {
    const processedAt = job.processedOn ?? null
    const finishedAt = job.finishedOn ?? null
    const createdAt = job.timestamp ?? 0
    const duration = processedAt !== null && finishedAt !== null ? finishedAt - processedAt : null
    return { processedAt, finishedAt, createdAt, duration }
  }

  /** Format a Bull job into our summary shape. */
  private formatJobSummary(job: BullMQJob, status: JobStatus): QueueJobSummary {
    const timings = QueueInspector.extractTimings(job)
    const data = job.data ?? null

    return {
      id: String(job.id),
      name: QueueInspector.cleanJobName(job.name ?? 'unknown'),
      status,
      data,
      payload: data,
      attempts: job.attemptsMade ?? 0,
      maxAttempts: (job.opts?.attempts as number) ?? 1,
      progress: job.progress ?? 0,
      failedReason: job.failedReason ?? null,
      createdAt: timings.createdAt,
      timestamp: timings.createdAt,
      processedAt: timings.processedAt,
      finishedAt: timings.finishedAt,
      duration: timings.duration,
    }
  }
}
