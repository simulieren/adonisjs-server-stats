import type { ApplicationService } from '@adonisjs/core/types'

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface QueueOverview {
  /** Total jobs currently being processed. */
  active: number

  /** Jobs waiting to be picked up by a worker. */
  waiting: number

  /** Jobs scheduled for future execution. */
  delayed: number

  /** Jobs that completed successfully. */
  completed: number

  /** Jobs that permanently failed. */
  failed: number

  /** Jobs paused in the queue. */
  paused: number
}

export interface QueueJobSummary {
  /** Bull job ID. */
  id: string

  /** Job name / type. */
  name: string

  /** Current job status. */
  status: 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'paused'

  /** Job payload (data). */
  data: any

  /** Number of attempts so far. */
  attempts: number

  /** Maximum allowed attempts. */
  maxAttempts: number

  /** Job progress (0-100 or custom). */
  progress: number | object

  /** Error message if the job failed, or null. */
  failedReason: string | null

  /** When the job was added (Unix timestamp ms). */
  createdAt: number

  /** When processing started (Unix timestamp ms), or null. */
  processedAt: number | null

  /** When the job finished (Unix timestamp ms), or null. */
  finishedAt: number | null

  /** Processing duration in ms, or null if not finished. */
  duration: number | null
}

export interface QueueJobDetail extends QueueJobSummary {
  /** Full stack trace if the job failed. */
  stackTrace: string[]

  /** Return value from the job handler, if any. */
  returnValue: any

  /** Job options (delay, priority, repeat, etc.). */
  opts: Record<string, any>
}

export interface QueueJobListResult {
  /** Jobs for the requested page. */
  jobs: QueueJobSummary[]

  /** Total number of jobs matching the status filter. */
  total: number
}

// ---------------------------------------------------------------------------
// QueueInspector
// ---------------------------------------------------------------------------

type JobStatus = 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'paused'

/**
 * Inspects Bull Queue jobs, counts, and allows retrying failed jobs.
 *
 * Designed for the full-page dashboard's Jobs section.
 * Only functional when `@rlanz/bull-queue` is installed.
 * All methods catch errors and return safe defaults.
 */
export class QueueInspector {
  constructor(private queueManager: any) {}

  /**
   * Detect whether `@rlanz/bull-queue` is available in the application container.
   */
  static async isAvailable(app: ApplicationService): Promise<boolean> {
    try {
      await app.container.make('queue')
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
   * @param status   Job status to filter by.
   * @param page     Page number (1-based).
   * @param perPage  Jobs per page.
   */
  async listJobs(
    status: JobStatus = 'active',
    page = 1,
    perPage = 25
  ): Promise<QueueJobListResult> {
    try {
      const queue = this.getQueue()
      if (!queue) return { jobs: [], total: 0 }

      const start = (page - 1) * perPage
      const end = start + perPage - 1

      const [rawJobs, counts] = await Promise.all([
        queue.getJobs([status], start, end) as Promise<any[]>,
        queue.getJobCounts(status) as Promise<Record<string, number>>,
      ])

      const jobs: QueueJobSummary[] = (rawJobs ?? [])
        .filter((job: any) => job !== null && job !== undefined)
        .map((job: any) => this.formatJobSummary(job, status))

      return {
        jobs,
        total: counts[status] ?? 0,
      }
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
   * Get the underlying Bull Queue instance from the queue manager.
   *
   * `@rlanz/bull-queue` exposes the BullMQ Queue via `.queue` on the manager
   * or via `.useQueue()`. We try both patterns for compatibility.
   */
  private getQueue(): any {
    try {
      // @rlanz/bull-queue v3+ exposes queue directly
      if (this.queueManager.queue) {
        return this.queueManager.queue
      }

      // Try getting the default queue
      if (typeof this.queueManager.useQueue === 'function') {
        return this.queueManager.useQueue('default')
      }

      // Fallback: the manager itself may be a Queue instance
      if (typeof this.queueManager.getJobCounts === 'function') {
        return this.queueManager
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Format a Bull job into our summary shape.
   */
  private formatJobSummary(job: any, status: JobStatus): QueueJobSummary {
    const processedAt = job.processedOn ?? null
    const finishedAt = job.finishedOn ?? null
    const duration = processedAt != null && finishedAt != null ? finishedAt - processedAt : null

    return {
      id: String(job.id),
      name: job.name ?? 'unknown',
      status,
      data: job.data ?? null,
      attempts: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? 1,
      progress: job.progress ?? 0,
      failedReason: job.failedReason ?? null,
      createdAt: job.timestamp ?? 0,
      processedAt,
      finishedAt,
      duration,
    }
  }
}
