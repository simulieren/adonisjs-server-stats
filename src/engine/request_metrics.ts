import { performance } from 'node:perf_hooks'

interface RequestRecord {
  timestamp: number
  durationMs: number
  statusCode: number
}

export class RequestMetrics {
  private records: RequestRecord[] = []
  private writeIndex = 0
  private count = 0
  private activeConnections = 0
  private maxRecords: number
  private windowMs: number

  constructor(opts?: { maxRecords?: number; windowMs?: number }) {
    this.maxRecords = opts?.maxRecords ?? 10_000
    this.windowMs = opts?.windowMs ?? 60_000
  }

  recordRequest(durationMs: number, statusCode: number) {
    const record: RequestRecord = {
      timestamp: performance.now(),
      durationMs,
      statusCode,
    }
    if (this.count < this.maxRecords) {
      this.records.push(record)
      this.count++
    } else {
      this.records[this.writeIndex] = record
    }
    this.writeIndex = (this.writeIndex + 1) % this.maxRecords
  }

  incrementActiveConnections() {
    this.activeConnections++
  }

  decrementActiveConnections() {
    this.activeConnections = Math.max(0, this.activeConnections - 1)
  }

  getMetrics() {
    const now = performance.now()
    const cutoff = now - this.windowMs

    let totalDuration = 0
    let errorCount = 0
    let validCount = 0

    for (let i = 0; i < this.count; i++) {
      const r = this.records[i]
      if (r.timestamp >= cutoff) {
        validCount++
        totalDuration += r.durationMs
        if (r.statusCode >= 500) {
          errorCount++
        }
      }
    }

    const windowSeconds = this.windowMs / 1000

    return {
      requestsPerSecond: validCount / windowSeconds,
      averageResponseTimeMs: validCount > 0 ? totalDuration / validCount : 0,
      errorRate: validCount > 0 ? (errorCount / validCount) * 100 : 0,
      activeConnections: this.activeConnections,
    }
  }
}
