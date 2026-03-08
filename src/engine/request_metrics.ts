import { performance } from 'node:perf_hooks'

interface RequestRecord {
  timestamp: number
  durationMs: number
  statusCode: number
}

interface WindowAccumulator {
  validCount: number
  totalDuration: number
  errorCount: number
}

function accumulateRecord(acc: WindowAccumulator, r: RequestRecord): void {
  acc.validCount++
  acc.totalDuration += r.durationMs
  if (r.statusCode >= 500) acc.errorCount++
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
    const acc: WindowAccumulator = { validCount: 0, totalDuration: 0, errorCount: 0 }

    if (this.count === this.maxRecords) {
      this.#scanFullBuffer(cutoff, acc)
    } else {
      this.#scanPartialBuffer(cutoff, acc)
    }

    const windowSeconds = this.windowMs / 1000

    return {
      requestsPerSecond: acc.validCount / windowSeconds,
      averageResponseTimeMs: acc.validCount > 0 ? acc.totalDuration / acc.validCount : 0,
      errorRate: acc.validCount > 0 ? (acc.errorCount / acc.validCount) * 100 : 0,
      activeConnections: this.activeConnections,
    }
  }

  #scanFullBuffer(cutoff: number, acc: WindowAccumulator): void {
    for (let j = 0; j < this.maxRecords; j++) {
      const idx = (this.writeIndex + j) % this.maxRecords
      const r = this.records[idx]
      if (r.timestamp >= cutoff) accumulateRecord(acc, r)
    }
  }

  #scanPartialBuffer(cutoff: number, acc: WindowAccumulator): void {
    let startIdx = 0
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.records[i].timestamp < cutoff) {
        startIdx = i + 1
        break
      }
    }
    for (let i = startIdx; i < this.count; i++) {
      accumulateRecord(acc, this.records[i])
    }
  }
}
