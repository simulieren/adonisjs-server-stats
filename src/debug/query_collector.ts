import { RingBuffer } from "./ring_buffer.js";
import { isExcludedRequest } from "../middleware/request_tracking_middleware.js";
import type { QueryRecord } from "./types.js";

/**
 * Listens to Lucid's `db:query` event and stores queries in a ring buffer.
 *
 * Requires `debug: true` on the Lucid connection config to enable event emission.
 * Tracks slow queries (>threshold) and duplicate SQL strings.
 */
export class QueryCollector {
  private buffer: RingBuffer<QueryRecord>;
  private slowThresholdMs: number;
  private emitter: any = null;
  private handler: ((data: any) => void) | null = null;

  constructor(maxQueries: number = 500, slowThresholdMs: number = 100) {
    this.buffer = new RingBuffer<QueryRecord>(maxQueries);
    this.slowThresholdMs = slowThresholdMs;
  }

  async start(emitter: any): Promise<void> {
    this.emitter = emitter;
    this.handler = (data: any) => {
      // Self-exclude: skip queries from the dashboard's dedicated SQLite connection
      if (data.connection === 'server_stats') return;
      // Self-exclude: skip queries triggered by debug panel polling requests
      if (isExcludedRequest()) return;

      const duration =
        typeof data.duration === "number"
          ? data.duration
          : Array.isArray(data.duration)
            ? data.duration[0] * 1e3 + data.duration[1] / 1e6
            : 0;

      const record: QueryRecord = {
        id: this.buffer.getNextId(),
        sql: data.sql || "",
        bindings: data.bindings || [],
        duration: Math.round(duration * 100) / 100,
        method: data.method || "unknown",
        model: data.model || null,
        connection: data.connection || "default",
        inTransaction: data.inTransaction || false,
        timestamp: Date.now(),
      };

      this.buffer.push(record);
    };

    if (emitter && typeof emitter.on === "function") {
      emitter.on("db:query", this.handler);
    }
  }

  stop(): void {
    if (
      this.emitter &&
      this.handler &&
      typeof this.emitter.off === "function"
    ) {
      this.emitter.off("db:query", this.handler);
    }
    this.handler = null;
    this.emitter = null;
  }

  getQueries(): QueryRecord[] {
    return this.buffer.toArray();
  }

  getLatest(n: number = 100): QueryRecord[] {
    return this.buffer.latest(n);
  }

  getSummary() {
    const queries = this.buffer.toArray();
    const total = queries.length;
    const slow = queries.filter(
      (q) => q.duration > this.slowThresholdMs,
    ).length;

    const sqlCounts = new Map<string, number>();
    for (const q of queries) {
      sqlCounts.set(q.sql, (sqlCounts.get(q.sql) || 0) + 1);
    }
    const duplicates = Array.from(sqlCounts.values()).filter(
      (c) => c > 1,
    ).length;

    const avgDuration =
      total > 0 ? queries.reduce((sum, q) => sum + q.duration, 0) / total : 0;

    return {
      total,
      slow,
      duplicates,
      avgDuration: Math.round(avgDuration * 100) / 100,
    };
  }

  getTotalCount(): number {
    return this.buffer.size();
  }

  clear(): void {
    this.buffer.clear();
  }

  /** Register a callback that fires whenever a new query is recorded. */
  onNewItem(cb: ((item: QueryRecord) => void) | null): void {
    this.buffer.onPush(cb);
  }

  /** Restore persisted records into the buffer and reset the ID counter. */
  loadRecords(records: QueryRecord[]): void {
    this.buffer.load(records);
    const maxId = records.reduce((m, r) => Math.max(m, r.id), 0);
    this.buffer.setNextId(maxId + 1);
  }
}
