import type { MetricCollector } from './collector.js'

export interface QueueCollectorOptions {
  queueName?: string
  connection: {
    host: string
    port: number
    password?: string
  }
}

export function queueCollector(opts: QueueCollectorOptions): MetricCollector {
  const queueName = opts.queueName ?? 'default'

  return {
    name: 'queue',

    async collect() {
      try {
        const { Queue } = await import('bullmq')
        const queue = new Queue(queueName, { connection: opts.connection })
        const [counts, workers] = await Promise.all([queue.getJobCounts(), queue.getWorkers()])
        await queue.close()
        return {
          queueActive: counts.active ?? 0,
          queueWaiting: counts.waiting ?? 0,
          queueDelayed: counts.delayed ?? 0,
          queueFailed: counts.failed ?? 0,
          queueWorkerCount: workers.length,
        }
      } catch {
        return {
          queueActive: 0,
          queueWaiting: 0,
          queueDelayed: 0,
          queueFailed: 0,
          queueWorkerCount: 0,
        }
      }
    },
  }
}
