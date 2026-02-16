import { RingBuffer } from "./ring_buffer.js";
import type { EventRecord } from "./types.js";

/**
 * Wraps the AdonisJS emitter to log all events with timestamps.
 * Uses monkey-patching of emitter.emit to intercept all events.
 */
export class EventCollector {
  private buffer: RingBuffer<EventRecord>;
  private originalEmit: ((...args: any[]) => any) | null = null;
  private emitter: any = null;

  constructor(maxEvents: number = 200) {
    this.buffer = new RingBuffer<EventRecord>(maxEvents);
  }

  start(emitter: any): void {
    if (!emitter || typeof emitter.emit !== "function") return;

    this.emitter = emitter;
    this.originalEmit = emitter.emit.bind(emitter);

    const self = this;
    emitter.emit = function (event: string | Function, data?: any) {
      // Resolve event name: class-based events use the class name, string events are used as-is
      const eventName = typeof event === "string" ? event : event?.name || "unknown";

      // Skip internal/noisy events and mail events (handled by EmailCollector)
      if (
        !eventName.startsWith("__") &&
        eventName !== "db:query" &&
        !eventName.startsWith("mail:") &&
        eventName !== "queued:mail:error"
      ) {
        const record: EventRecord = {
          id: self.buffer.getNextId(),
          event: eventName,
          data: self.summarizeData(data),
          timestamp: Date.now(),
        };
        self.buffer.push(record);
      }

      return self.originalEmit!.call(emitter, event, data);
    };
  }

  stop(): void {
    if (this.emitter && this.originalEmit) {
      this.emitter.emit = this.originalEmit;
    }
    this.originalEmit = null;
    this.emitter = null;
  }

  private summarizeData(data: any): string | null {
    if (data === undefined || data === null) return null;

    try {
      if (typeof data === "string") return data;
      const json = JSON.stringify(data, this.safeReplacer(), 2);
      // Cap at 4KB per event to avoid memory bloat
      return json.length > 4096 ? json.slice(0, 4096) + "\n..." : json;
    } catch {
      if (typeof data === "object" && data.constructor?.name) {
        return `[${data.constructor.name}]`;
      }
      return typeof data;
    }
  }

  private safeReplacer() {
    const seen = new WeakSet();
    return (_key: string, value: any) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
      if (typeof value === "bigint") return value.toString();
      return value;
    };
  }

  getEvents(): EventRecord[] {
    return this.buffer.toArray();
  }

  getLatest(n: number = 100): EventRecord[] {
    return this.buffer.latest(n);
  }

  getTotalCount(): number {
    return this.buffer.size();
  }

  clear(): void {
    this.buffer.clear();
  }

  /** Restore persisted records into the buffer and reset the ID counter. */
  loadRecords(records: EventRecord[]): void {
    this.buffer.load(records);
    const maxId = records.reduce((m, r) => Math.max(m, r.id), 0);
    this.buffer.setNextId(maxId + 1);
  }
}
