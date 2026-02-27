import os from 'node:os'

import type { MetricCollector } from './collector.js'

/**
 * Reports OS-level system metrics: load averages, memory, and uptime.
 *
 * **Metrics produced:**
 * - `systemLoadAvg1m` / `systemLoadAvg5m` / `systemLoadAvg15m` -- OS load averages
 * - `systemMemoryTotalMb` -- total system memory (MB)
 * - `systemMemoryFreeMb` -- free system memory (MB)
 * - `systemUptime` -- OS uptime in seconds
 *
 * **Peer dependencies:** none
 */
export function systemCollector(): MetricCollector {
  return {
    name: 'system',
    label: 'system — load avg, memory, uptime',

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
