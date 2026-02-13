import type { MetricCollector } from '../collectors/collector.js'

export class StatsEngine {
  private collectors: MetricCollector[]
  private latestStats: Record<string, string | number | boolean> = {}

  constructor(collectors: MetricCollector[]) {
    this.collectors = collectors
  }

  async start(): Promise<void> {
    for (const collector of this.collectors) {
      await collector.start?.()
    }
  }

  async stop(): Promise<void> {
    for (const collector of this.collectors) {
      await collector.stop?.()
    }
  }

  async collect(): Promise<Record<string, string | number | boolean>> {
    const results = await Promise.all(
      this.collectors.map(async (collector) => {
        try {
          return await collector.collect()
        } catch {
          return {}
        }
      })
    )

    this.latestStats = Object.assign({}, ...results, { timestamp: Date.now() })
    return this.latestStats
  }

  getLatestStats(): Record<string, string | number | boolean> {
    return this.latestStats
  }
}
