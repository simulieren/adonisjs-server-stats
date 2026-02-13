import os from 'node:os'

import type { MetricCollector } from './collector.js'

export function systemCollector(): MetricCollector {
  return {
    name: 'system',

    collect() {
      const loadAvg = os.loadavg()
      return {
        systemLoadAvg1m: loadAvg[0],
        systemLoadAvg5m: loadAvg[1],
        systemLoadAvg15m: loadAvg[2],
        systemMemoryTotalMb: os.totalmem() / (1024 * 1024),
        systemMemoryFreeMb: os.freemem() / (1024 * 1024),
        systemUptime: os.uptime(),
      }
    },
  }
}
