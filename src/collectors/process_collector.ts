import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

import type { MetricCollector } from './collector.js'

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
