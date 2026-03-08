/**
 * In-flight request coalescing with short-lived result caching.
 *
 * - coalesce(): prevents concurrent identical calls from executing
 *   in parallel. Only ONE executes; others get the same promise.
 * - cached(): adds a TTL layer on top of coalesce so repeat
 *   requests within the window serve stale data instantly.
 */
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
      this.resultCache.set(key, {
        data: result,
        expiresAt: Date.now() + ttlMs,
      })
      return result
    })
  }

  /** Clear all cached results (does not affect in-flight requests). */
  clearCache(): void {
    this.resultCache.clear()
  }
}
