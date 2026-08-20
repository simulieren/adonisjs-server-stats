/**
 * In-flight request coalescing with short-lived result caching.
 *
 * - coalesce(): prevents concurrent identical calls from executing
 *   in parallel. Only ONE executes; others get the same promise.
 * - cached(): adds a TTL layer on top of coalesce so repeat
 *   requests within the window serve stale data instantly.
 */
/**
 * Hard cap on retained results. Keys embed user input (search terms, filters,
 * pagination), so without a bound a dashboard viewer could grow the heap
 * without limit by walking distinct queries. TTLs are 1-10s, so anything past
 * a few hundred entries is expired garbage anyway.
 */
const MAX_RESULT_ENTRIES = 500

export class CoalesceCache {
  private inflight = new Map<string, Promise<unknown>>()
  private resultCache = new Map<string, { data: unknown; expiresAt: number }>()

  /**
   * Coalesce concurrent calls with the same key.
   * Only the first call actually executes `fn`; subsequent
   * concurrent calls receive the same promise.
   */
  coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>

    const promise = fn().finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  /**
   * Return a cached result if within TTL, otherwise
   * fall through to coalesce().
   */
  cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const entry = this.resultCache.get(key)
    if (entry && Date.now() < entry.expiresAt) {
      return Promise.resolve(entry.data as T)
    }

    return this.coalesce(key, async () => {
      const result = await fn()
      this.evictForSpace()
      this.resultCache.set(key, {
        data: result,
        expiresAt: Date.now() + ttlMs,
      })
      return result
    })
  }

  /** Drop expired entries on write; if still at the cap, drop oldest first. */
  private evictForSpace(): void {
    if (this.resultCache.size < MAX_RESULT_ENTRIES) return
    const now = Date.now()
    for (const [key, entry] of this.resultCache) {
      if (entry.expiresAt <= now) this.resultCache.delete(key)
    }
    // Map iteration is insertion-ordered, so the front is the oldest.
    while (this.resultCache.size >= MAX_RESULT_ENTRIES) {
      const oldest = this.resultCache.keys().next().value
      if (oldest === undefined) break
      this.resultCache.delete(oldest)
    }
  }

  /** Clear all cached results (does not affect in-flight requests). */
  clearCache(): void {
    this.resultCache.clear()
  }
}
