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

/** Fetch job counts from a BullMQ queue. */
async function fetchQueueCounts(queueName: string, connection: QueueRedisConnection) {
  const { Queue } = await import('bullmq')
  const queue = new Queue(queueName, { connection })
  const [counts, workers] = await Promise.all([queue.getJobCounts(), queue.getWorkers()])
  await queue.close()
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
  const warned: WarnState = { missingBullmq: false, connectionError: false, missingConnection: false }

  return {
    name: 'queue',
    label: `queue — ${queueName} @ ${opts.connection?.host ?? '?'}:${opts.connection?.port ?? '?'}`,

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
        return await fetchQueueCounts(queueName, opts.connection)
      } catch (error) {
        handleQueueError(error, queueName, opts.connection, warned)
        return QUEUE_DEFAULTS
      }
    },
  }
}
