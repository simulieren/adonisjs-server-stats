// ---------------------------------------------------------------------------
// Shared response types and contract interface for queue inspection.
//
// Both QueueInspector (BullMQ / @rlanz/bull-queue) and
// AdonisQueueInspector (@adonisjs/queue) implement QueueInspectorContract.
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
  /** Bull / @boringnode job ID. */
  id: string

  /** Human-readable job name (cleaned from file URLs). */
  name: string

  /** Current job status. */
  status: 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'paused'

  /** Job payload (data). */
  data: Record<string, unknown> | null

  /** Alias for `data` — used by some frontends. */
  payload: Record<string, unknown> | null

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
  returnValue: unknown

  /** Job options (delay, priority, repeat, etc.). */
  opts: Record<string, unknown>
}

export interface QueueJobListResult {
  /** Jobs for the requested page. */
  jobs: QueueJobSummary[]

  /** Total number of jobs matching the status filter. */
  total: number
}

/** The statuses understood by the dashboard UI. */
export type JobStatus = 'active' | 'waiting' | 'delayed' | 'completed' | 'failed' | 'paused'

/** All dashboard-level job statuses. */
export const ALL_STATUSES: JobStatus[] = [
  'active',
  'waiting',
  'delayed',
  'completed',
  'failed',
  'paused',
]

/**
 * Common interface implemented by both BullMQ and @adonisjs/queue inspectors.
 *
 * All methods catch errors internally and return safe defaults.
 */
export interface QueueInspectorContract {
  getOverview(): Promise<QueueOverview>
  listJobs(status: JobStatus | 'all', page?: number, perPage?: number): Promise<QueueJobListResult>
  getJob(id: string): Promise<QueueJobDetail | null>
  retryJob(id: string): Promise<boolean>
}
