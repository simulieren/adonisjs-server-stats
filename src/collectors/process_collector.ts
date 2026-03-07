import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

import type { MetricCollector } from './collector.js'

/**
 * Reports Node.js process metrics: CPU, memory, event loop, and uptime.
 *
 * Uses `monitorEventLoopDelay` for accurate event loop lag measurement
 * and `process.cpuUsage()` for CPU percentage calculation.
 *
 * **Metrics produced:**
 * - `nodeVersion` -- Node.js version string
 * - `uptime` -- process uptime in seconds
 * - `memHeapUsed` -- V8 heap used (bytes)
 * - `memHeapTotal` -- V8 heap allocated (bytes)
 * - `memRss` -- resident set size (bytes)
 * - `cpuPercent` -- CPU usage (% of one core)
 * - `eventLoopLag` -- event loop latency (ms)
 *
 * **Peer dependencies:** none
 */
export function processCollector(): MetricCollector {
  const histogram = monitorEventLoopDelay({ resolution: 20 })
  let lastCpuUsage = process.cpuUsage()
  let lastCpuTime = performance.now()
  let started = false

  function getCpuPercent(): number {
    const now = performance.now()
    const elapsed = (now - lastCpuTime) * 1000
    const usage = process.cpuUsage(lastCpuUsage)
    lastCpuUsage = process.cpuUsage()
    lastCpuTime = now
    if (elapsed <= 0) return 0
    return Math.min(100, ((usage.user + usage.system) / elapsed) * 100)
  }

  return {
    name: 'process',
    label: 'process — cpu, memory, event loop, uptime',

    getConfig() {
      return {}
    },

    start() {
      if (!started) {
        histogram.enable()
        started = true
      }
    },

    stop() {
      if (started) {
        histogram.disable()
        started = false
      }
    },

    collect() {
      const mem = process.memoryUsage()
      return {
        nodeVersion: process.version,
        uptime: process.uptime(),
        memHeapUsed: mem.heapUsed,
        memHeapTotal: mem.heapTotal,
        memRss: mem.rss,
        cpuPercent: getCpuPercent(),
        eventLoopLag: histogram.mean / 1e6,
      }
    },
  }
}
