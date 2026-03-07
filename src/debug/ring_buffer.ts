/**
 * Generic typed ring buffer (circular buffer).
 * Overwrites oldest entries when capacity is exceeded.
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[]
  private head: number = 0
  private count: number = 0
  private nextId: number = 1
  private pushCallback: ((item: T) => void) | null = null

  constructor(private capacity: number) {
    this.buffer = Array.from<T | undefined>({ length: capacity })
  }

  /** Register a callback that fires whenever a new item is pushed. */
  onPush(cb: ((item: T) => void) | null): void {
    this.pushCallback = cb
  }

  push(item: T): void {
    this.buffer[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) {
      this.count++
    }
    this.pushCallback?.(item)
  }

  /** Returns all items in insertion order (oldest first). */
  toArray(): T[] {
    if (this.count === 0) return []

    const result: T[] = []
    const start = this.count < this.capacity ? 0 : this.head

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity
      result.push(this.buffer[idx] as T)
    }

    return result
  }

  /** Returns the most recent N items (newest first). */
  latest(n: number): T[] {
    if (this.count === 0) return []
    const take = Math.min(n, this.count)
    const result: T[] = Array.from({ length: take })

    // Walk backwards from the most recently inserted item
    for (let i = 0; i < take; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity
      result[i] = this.buffer[idx] as T
    }

    return result
  }

  getNextId(): number {
    return this.nextId++
  }

  size(): number {
    return this.count
  }

  getCapacity(): number {
    return this.capacity
  }

  clear(): void {
    this.buffer = Array.from<T | undefined>({ length: this.capacity })
    this.head = 0
    this.count = 0
  }

  /**
   * Find a single item by predicate, searching from newest to oldest.
   * Returns immediately on first match without copying the buffer.
   */
  findFromEnd(predicate: (item: T) => boolean): T | undefined {
    if (this.count === 0) return undefined

    const start = this.count < this.capacity ? 0 : this.head

    for (let i = this.count - 1; i >= 0; i--) {
      const idx = (start + i) % this.capacity
      const item = this.buffer[idx] as T
      if (predicate(item)) return item
    }

    return undefined
  }

  /**
   * Collect items from the end of the buffer while the predicate holds.
   * Iterates from newest to oldest and stops at the first non-match.
   * Returns items in insertion order (oldest first).
   *
   * Useful for efficiently getting "items since ID X" without copying the
   * entire buffer, since IDs are monotonically increasing.
   */
  collectFromEnd(predicate: (item: T) => boolean): T[] {
    if (this.count === 0) return []

    const result: T[] = []
    const start = this.count < this.capacity ? 0 : this.head

    for (let i = this.count - 1; i >= 0; i--) {
      const idx = (start + i) % this.capacity
      const item = this.buffer[idx] as T
      if (!predicate(item)) break
      result.push(item)
    }

    return result.reverse()
  }

  /** Bulk-load items (e.g. from disk). Pushes each in order, respecting capacity. */
  load(items: T[]): void {
    for (const item of items) {
      this.push(item)
    }
  }

  /** Restore the auto-increment counter (e.g. after loading persisted data). */
  setNextId(id: number): void {
    this.nextId = id
  }
}
