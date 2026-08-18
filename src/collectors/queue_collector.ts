import { log, dim, bold } from '../utils/logger.js'

import type { MetricCollector } from './collector.js'

/**
 * Redis connection details for BullMQ.
 */
export interface QueueRedisConnection {
  /** Redis host. */
  host: string

  /** Redis port. */
  port: number

  /** Redis password (optional for passwordless connections). */
  password?: string
}

/**
 * Options for {@link queueCollector}.
 */
export interface QueueCollectorOptions {
  /**
   * BullMQ queue name to monitor.
   * @default 'default'
   */
  queueName?: string

  /**
   * Redis connection used by BullMQ.
   *
   * This is a **separate** connection from your AdonisJS Redis config
   * because BullMQ manages its own connections internally.
   *
   * @example
   * ```ts
   * connection: {
   *   host: env.get('QUEUE_REDIS_HOST'),
   *   port: env.get('QUEUE_REDIS_PORT'),
   *   password: env.get('QUEUE_REDIS_PASSWORD'),
   * }
   * ```
   */
  connection: QueueRedisConnection
}

/** Default metrics returned when queue data is unavailable. */
const QUEUE_DEFAULTS = {
  queueActive: 0,
  queueWaiting: 0,
  queueDelayed: 0,
  queueFailed: 0,
  queueWorkerCount: 0,
}

interface WarnState {
  missingBullmq: boolean
  connectionError: boolean
  missingConnection: boolean
}

/** Minimal shape of the BullMQ Queue we rely on. */
interface BullQueue {
  getJobCounts(): Promise<Record<string, number>>
  getWorkers(): Promise<unknown[]>
  close(): Promise<void>
}

/** Fetch job counts from a long-lived BullMQ queue instance. */
async function fetchQueueCounts(queue: BullQueue) {
  const [counts, workers] = await Promise.all([queue.getJobCounts(), queue.getWorkers()])
  return {
    queueActive: counts.active ?? 0,
    queueWaiting: counts.waiting ?? 0,
    queueDelayed: counts.delayed ?? 0,
    queueFailed: counts.failed ?? 0,
    queueWorkerCount: workers.length,
  }
}

/** Handle queue collection errors with one-time warnings. */
function handleQueueError(
  error: unknown,
  queueName: string,
  connection: QueueRedisConnection,
  warned: WarnState
) {
  const message = error instanceof Error ? error.message : String(error)
  const isImportError =
    message.includes('Cannot find package') ||
    message.includes('MODULE_NOT_FOUND') ||
    message.includes('ERR_MODULE_NOT_FOUND')

  if (isImportError) {
    if (!warned.missingBullmq) {
      warned.missingBullmq = true
      log.warn(`Queue collector ${bold(queueName)}: ${bold('bullmq')} is not installed`)
      log.block('Install the peer dependency to enable queue metrics:', [
        `${bold('npm install bullmq')}`,
        dim('Queue metrics will return zeros until bullmq is available.'),
      ])
    }
  } else if (!warned.connectionError) {
    warned.connectionError = true
    const { host, port } = connection
    log.warn(
      `Queue collector ${bold(queueName)}: cannot connect to Redis at ${bold(`${host}:${port}`)}`
    )
    log.block('Connection failed:', [
      `${dim('Error:')} ${message}`,
      dim('Is Redis running? Check with: redis-cli ping'),
      dim('Queue metrics will return zeros until the connection succeeds.'),
    ])
  }
}

/**
 * Monitors a BullMQ job queue for active, waiting, delayed, and failed jobs.
 *
 * Returns zeros if BullMQ is unavailable or the queue cannot be reached.
 *
 * **Peer dependencies:** `bullmq`
 */
export function queueCollector(opts: QueueCollectorOptions): MetricCollector {
  const queueName = opts.queueName ?? 'default'
  const warned: WarnState = {
    missingBullmq: false,
    connectionError: false,
    missingConnection: false,
  }

  // The BullMQ Queue owns a Redis connection. Create it once and reuse it
  // across every poll tick so a rejected getJobCounts()/getWorkers() can never
  // leak a connection (the previous per-tick `new Queue(...)` leaked one on
  // every failure because close() was skipped). The queue is created lazily on
  // first collect so a missing `bullmq` peer dependency degrades gracefully.
  let queue: BullQueue | null = null

  async function getQueue(connection: QueueRedisConnection): Promise<BullQueue> {
    if (queue) return queue
    const { Queue } = await import('bullmq')
    queue = new Queue(queueName, { connection }) as unknown as BullQueue
    return queue
  }

  return {
    name: 'queue',
    label: `queue — ${queueName} @ ${opts.connection?.host ?? '?'}:${opts.connection?.port ?? '?'}`,

    async stop() {
      if (queue) {
        await queue.close().catch(() => {})
        queue = null
      }
    },

    getConfig() {
      return {
        queueName,
        connectionHost: opts.connection?.host ?? '?',
        connectionPort: opts.connection?.port ?? '?',
      }
    },

    async collect() {
      if (!opts.connection) {
        if (!warned.missingConnection) {
          warned.missingConnection = true
          log.warn(`Queue collector ${bold(queueName)}: missing ${bold('connection')} option`)
          log.block('Provide a Redis connection when creating the collector:', [
            `${dim('queueCollector({ connection: { host: "localhost", port: 6379 } })')}`,
          ])
        }
        return QUEUE_DEFAULTS
      }

      try {
        return await fetchQueueCounts(await getQueue(opts.connection))
      } catch (error) {
        handleQueueError(error, queueName, opts.connection, warned)
        return QUEUE_DEFAULTS
      }
    },
  }
}
