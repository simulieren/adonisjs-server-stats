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

  /** Human-readable job name (cleaned from file URLs). */
  name: string

  /** Current job status. */
  status: 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'paused'

  /** Job payload (data). */
  data: any

  /** Alias for `data` — used by some frontends. */
  payload: any

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

  /** Alias for `createdAt` — BullMQ compat. */
  timestamp: number

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
const ALL_STATUSES: JobStatus[] = ['active', 'waiting', 'delayed', 'completed', 'failed', 'paused']

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
        queue.getJobs(statuses, start, end) as Promise<any[]>,
        queue.getJobCounts(...ALL_STATUSES) as Promise<Record<string, number>>,
      ])

      const jobs: QueueJobSummary[] = (rawJobs ?? [])
        .filter((job: any) => job !== null && job !== undefined)
        .map((job: any) => {
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
  private getQueue(): any {
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
        return this.queueManager
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Infer a job's status from its internal fields (avoids async getState() call).
   */
  private inferStatus(job: any): JobStatus | null {
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

  /**
   * Format a Bull job into our summary shape.
   */
  private formatJobSummary(job: any, status: JobStatus): QueueJobSummary {
    const processedAt = job.processedOn ?? null
    const finishedAt = job.finishedOn ?? null
    const duration = processedAt !== null && finishedAt !== null ? finishedAt - processedAt : null
    const createdAt = job.timestamp ?? 0

    const data = job.data ?? null

    return {
      id: String(job.id),
      name: QueueInspector.cleanJobName(job.name ?? 'unknown'),
      status,
      data,
      payload: data,
      attempts: job.attemptsMade ?? 0,
      maxAttempts: job.opts?.attempts ?? 1,
      progress: job.progress ?? 0,
      failedReason: job.failedReason ?? null,
      createdAt,
      timestamp: createdAt,
      processedAt,
      finishedAt,
      duration,
    }
  }
}
