/**
 * Generic typed ring buffer (circular buffer).
 * Overwrites oldest entries when capacity is exceeded.
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private count: number = 0;
  private nextId: number = 1;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** Returns all items in insertion order (oldest first). */
  toArray(): T[] {
    if (this.count === 0) return [];

    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      result.push(this.buffer[idx] as T);
    }

    return result;
  }

  /** Returns the most recent N items (newest first). */
  latest(n: number): T[] {
    const all = this.toArray();
    return all.slice(-n).reverse();
  }

  getNextId(): number {
    return this.nextId++;
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  /** Bulk-load items (e.g. from disk). Pushes each in order, respecting capacity. */
  load(items: T[]): void {
    for (const item of items) {
      this.push(item);
    }
  }

  /** Restore the auto-increment counter (e.g. after loading persisted data). */
  setNextId(id: number): void {
    this.nextId = id;
  }
}
