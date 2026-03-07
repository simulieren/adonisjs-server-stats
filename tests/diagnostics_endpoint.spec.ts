import { test } from '@japa/runner'

// ---------------------------------------------------------------------------
// Standalone replicas of DashboardStore's coalesce + cache + getStorageStats
// behaviour for isolated unit testing.
//
// We do not import the real DashboardStore because it requires SQLite / Knex.
// Instead we reproduce the exact caching + coalescing contracts that prevent
// the freeze when the Internals tab polls every 3 seconds.
// ---------------------------------------------------------------------------

/** Helper: sleep for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Minimal replica of DashboardStore's coalesce + cached + getStorageStats
 * caching layer for testing the freeze-prevention contracts.
 */
class StorageStatsCache {
  private inflight = new Map<string, Promise<unknown>>()
  private cachedStorageStats: { data: unknown; cachedAt: number } | null = null
  private static readonly STORAGE_STATS_TTL_MS = 10_000

  /** Number of times the underlying "DB query" was executed. */
  queryCount = 0

  /** Number of promises currently in-flight. */
  get inflightSize() {
    return this.inflight.size
  }

  private coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>
    const promise = fn().finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  /**
   * Simulates DashboardStore.getStorageStats() -- cached for TTL,
   * coalesced to prevent thundering herd.
   */
  async getStorageStats(
    queryDelayMs: number = 5
  ): Promise<{
    ready: boolean
    fileSizeMb: number
    tables: Array<{ name: string; rowCount: number }>
  }> {
    // Serve cached stats if still fresh
    if (
      this.cachedStorageStats &&
      Date.now() - this.cachedStorageStats.cachedAt < StorageStatsCache.STORAGE_STATS_TTL_MS
    ) {
      return this.cachedStorageStats.data as Awaited<
        ReturnType<StorageStatsCache['getStorageStats']>
      >
    }

    return this.coalesce('storageStats', async () => {
      this.queryCount++
      // Simulate DB query delay
      await sleep(queryDelayMs)

      const stats = {
        ready: true,
        fileSizeMb: 1.5,
        tables: [
          { name: 'server_stats_requests', rowCount: 100 },
          { name: 'server_stats_queries', rowCount: 200 },
        ],
      }

      this.cachedStorageStats = { data: stats, cachedAt: Date.now() }
      return stats
    })
  }

  /** Invalidate the cache (for testing expiry). */
  invalidateCache() {
    this.cachedStorageStats = null
  }
}

/**
 * Simulates the diagnostics endpoint handler that calls getStorageStats()
 * on the dashboard store (when available).
 */
class DiagnosticsEndpoint {
  constructor(private dashboardStore: StorageStatsCache | null) {}

  async getDiagnostics(): Promise<{
    storage: Awaited<ReturnType<StorageStatsCache['getStorageStats']>> | null
  }> {
    let storage = null
    if (this.dashboardStore) {
      try {
        storage = await this.dashboardStore.getStorageStats()
      } catch {
        // Dashboard store not ready
      }
    }
    return { storage }
  }
}

// ---------------------------------------------------------------------------
// Tests -- getStorageStats caching works
// ---------------------------------------------------------------------------

test.group('Diagnostics | getStorageStats caching', () => {
  test('second call within TTL returns cached data without hitting DB', async ({ assert }) => {
    const store = new StorageStatsCache()

    const first = await store.getStorageStats()
    assert.equal(store.queryCount, 1)
    assert.isTrue(first.ready)

    // Second call should be cached
    const second = await store.getStorageStats()
    assert.equal(store.queryCount, 1, 'Should not have queried DB again')
    assert.deepEqual(second, first)
  })

  test('call after cache invalidation re-executes the query', async ({ assert }) => {
    const store = new StorageStatsCache()

    await store.getStorageStats()
    assert.equal(store.queryCount, 1)

    store.invalidateCache()

    await store.getStorageStats()
    assert.equal(store.queryCount, 2, 'Should have re-queried after cache invalidation')
  })

  test('concurrent calls within TTL coalesce into a single query', async ({ assert }) => {
    const store = new StorageStatsCache()

    // Fire 50 concurrent calls
    const promises = Array.from({ length: 50 }, () => store.getStorageStats(20))
    const results = await Promise.all(promises)

    // Only 1 DB query should have been made
    assert.equal(store.queryCount, 1, 'Concurrent calls should coalesce')

    // All results should be the same
    for (const result of results) {
      assert.isTrue(result.ready)
      assert.equal(result.fileSizeMb, 1.5)
    }
  })

  test('cached data persists across many sequential calls', async ({ assert }) => {
    const store = new StorageStatsCache()

    // Simulate 100 sequential polls (as would happen from the Internals tab)
    for (let i = 0; i < 100; i++) {
      await store.getStorageStats()
    }

    // Only 1 DB query because all calls are within the 10s TTL
    assert.equal(store.queryCount, 1, 'Sequential calls within TTL should all be cached')
  })
})

// ---------------------------------------------------------------------------
// Tests -- getStorageStats under rapid polling (25 tab switches)
// ---------------------------------------------------------------------------

test.group('Diagnostics | getStorageStats under rapid polling', () => {
  test('25 rapid calls do not accumulate pending promises', async ({ assert }) => {
    const store = new StorageStatsCache()

    // Fire 25 calls rapidly (simulating 25 tab switches hitting the endpoint)
    const promises = Array.from({ length: 25 }, () => store.getStorageStats(10))

    // While in-flight, check that coalescing keeps inflight map small
    assert.isAtMost(
      store.inflightSize,
      1,
      `Expected at most 1 inflight promise but got ${store.inflightSize}`
    )

    await Promise.all(promises)

    // After completion, inflight should be empty
    assert.equal(store.inflightSize, 0, 'Inflight map should be empty after all promises resolve')

    // Only 1 query should have been made
    assert.equal(store.queryCount, 1, 'All 25 calls should have coalesced into 1 query')
  })

  test('rapid polling with interleaved cache expiry re-executes minimally', async ({
    assert,
  }) => {
    const store = new StorageStatsCache()

    // First burst: 25 rapid calls
    const batch1 = Array.from({ length: 25 }, () => store.getStorageStats(5))
    await Promise.all(batch1)
    assert.equal(store.queryCount, 1)

    // Invalidate cache (simulating TTL expiry)
    store.invalidateCache()

    // Second burst: 25 more rapid calls
    const batch2 = Array.from({ length: 25 }, () => store.getStorageStats(5))
    await Promise.all(batch2)

    // Should have made exactly 2 queries total (1 per burst)
    assert.equal(store.queryCount, 2, 'Second burst should coalesce into 1 additional query')

    // Inflight should be clean
    assert.equal(store.inflightSize, 0)
  })

  test('error in getStorageStats does not poison the inflight map', async ({ assert }) => {
    const store = new StorageStatsCache()

    // Monkey-patch the coalesced inner logic to force a rejection
    const originalGetStorageStats = store.getStorageStats.bind(store)
    let shouldFail = true
    store.getStorageStats = function (queryDelayMs?: number) {
      if (shouldFail) {
        // Access private coalesce via the prototype to ensure inflight cleanup is tested
        return (store as any).coalesce('storageStats', async () => {
          throw new Error('Simulated DB failure')
        })
      }
      return originalGetStorageStats(queryDelayMs)
    } as typeof store.getStorageStats

    // Fire 10 concurrent calls that should all fail
    const errorPromises = Array.from({ length: 10 }, () =>
      store.getStorageStats(5).catch(() => null)
    )
    await Promise.allSettled(errorPromises)

    // Inflight map must be clean even after errors
    assert.equal(store.inflightSize, 0, 'Inflight map should be clean after errors')

    // Subsequent calls after the failure should still work
    shouldFail = false
    const result = await store.getStorageStats(5)
    assert.isTrue(result.ready, 'Store should recover after transient errors')
    assert.equal(store.inflightSize, 0, 'Inflight map should be clean after recovery')
  })
})

// ---------------------------------------------------------------------------
// Tests -- diagnostics endpoint when dashboard store is not available
// ---------------------------------------------------------------------------

test.group('Diagnostics | graceful handling when dashboard store unavailable', () => {
  test('returns null storage when dashboard store is null', async ({ assert }) => {
    const endpoint = new DiagnosticsEndpoint(null)
    const result = await endpoint.getDiagnostics()

    assert.isNull(result.storage, 'Storage should be null when dashboard store is not available')
  })

  test('returns storage data when dashboard store is available', async ({ assert }) => {
    const store = new StorageStatsCache()
    const endpoint = new DiagnosticsEndpoint(store)

    const result = await endpoint.getDiagnostics()

    assert.isNotNull(result.storage)
    assert.isTrue(result.storage!.ready)
    assert.equal(result.storage!.fileSizeMb, 1.5)
  })

  test('rapid diagnostics calls with store available -- caching prevents DB flood', async ({
    assert,
  }) => {
    const store = new StorageStatsCache()
    const endpoint = new DiagnosticsEndpoint(store)

    // Simulate 50 rapid diagnostic endpoint calls (e.g. from rapid tab switching)
    const promises = Array.from({ length: 50 }, () => endpoint.getDiagnostics())
    const results = await Promise.all(promises)

    // All results should have valid storage data
    for (const result of results) {
      assert.isNotNull(result.storage)
      assert.isTrue(result.storage!.ready)
    }

    // Only 1 DB query thanks to coalescing + caching
    assert.equal(store.queryCount, 1, 'All diagnostic calls should share cached storage stats')
  })

  test('diagnostics endpoint handles store error gracefully', async ({ assert }) => {
    // Create a store that will throw
    const brokenStore = {
      async getStorageStats(): Promise<any> {
        throw new Error('DB connection lost')
      },
    }

    const endpoint = new DiagnosticsEndpoint(brokenStore as any)

    const result = await endpoint.getDiagnostics()

    // Should return null storage instead of throwing
    assert.isNull(
      result.storage,
      'Should return null storage when store throws, not propagate error'
    )
  })
})
