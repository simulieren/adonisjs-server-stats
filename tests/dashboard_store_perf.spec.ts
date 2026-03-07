import { test } from '@japa/runner'

/**
 * Standalone replica of DashboardStore's coalesce + cached helpers
 * for isolated unit testing.
 */
class CoalesceCache {
  private inflight = new Map<string, Promise<unknown>>()
  private cache = new Map<string, { data: unknown; expiresAt: number }>()

  coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>
    const promise = fn().finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key)
    if (entry && Date.now() < entry.expiresAt) return Promise.resolve(entry.data as T)
    return this.coalesce(key, async () => {
      const result = await fn()
      this.cache.set(key, { data: result, expiresAt: Date.now() + ttlMs })
      return result
    })
  }

  clearCache() {
    this.cache.clear()
  }
  get inflightSize() {
    return this.inflight.size
  }
  get cacheSize() {
    return this.cache.size
  }
}

/** Helper: sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Coalescing tests
// ---------------------------------------------------------------------------

test.group('CoalesceCache | coalesce', () => {
  test('single call executes fn once', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const result = await cc.coalesce('a', async () => {
      callCount++
      return 42
    })

    assert.equal(result, 42)
    assert.equal(callCount, 1)
  })

  test('concurrent identical calls share the same promise', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async () => {
      callCount++
      await sleep(20)
      return 'shared'
    }

    const promises = Array.from({ length: 10 }, () => cc.coalesce('a', fn))
    const results = await Promise.all(promises)

    assert.equal(callCount, 1)
    for (const r of results) {
      assert.equal(r, 'shared')
    }
  })

  test('different keys execute independently', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCountA = 0
    let callCountB = 0

    const promiseA = cc.coalesce('a', async () => {
      callCountA++
      await sleep(10)
      return 'resultA'
    })

    const promiseB = cc.coalesce('b', async () => {
      callCountB++
      await sleep(10)
      return 'resultB'
    })

    const [resultA, resultB] = await Promise.all([promiseA, promiseB])

    assert.equal(callCountA, 1)
    assert.equal(callCountB, 1)
    assert.equal(resultA, 'resultA')
    assert.equal(resultB, 'resultB')
  })

  test('after completion, next call executes fresh', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    await cc.coalesce('a', async () => {
      callCount++
      return 'first'
    })

    const result = await cc.coalesce('a', async () => {
      callCount++
      return 'second'
    })

    assert.equal(callCount, 2)
    assert.equal(result, 'second')
  })

  test('error in fn clears the inflight entry', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    try {
      await cc.coalesce('a', async () => {
        callCount++
        throw new Error('boom')
      })
    } catch {
      // expected
    }

    assert.equal(callCount, 1)
    assert.equal(cc.inflightSize, 0)

    // Next call should retry successfully
    const result = await cc.coalesce('a', async () => {
      callCount++
      return 'recovered'
    })

    assert.equal(callCount, 2)
    assert.equal(result, 'recovered')
  })

  test('concurrent calls all get the error', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async () => {
      callCount++
      await sleep(10)
      throw new Error('concurrent boom')
    }

    const promises = Array.from({ length: 5 }, () => cc.coalesce('a', fn))

    const results = await Promise.allSettled(promises)

    assert.equal(callCount, 1)
    for (const r of results) {
      assert.equal(r.status, 'rejected')
      assert.instanceOf((r as PromiseRejectedResult).reason, Error)
      assert.equal((r as PromiseRejectedResult).reason.message, 'concurrent boom')
    }

    assert.equal(cc.inflightSize, 0)
  })
})

// ---------------------------------------------------------------------------
// Cache tests
// ---------------------------------------------------------------------------

test.group('CoalesceCache | cached', () => {
  test('first call executes fn and caches result', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const result = await cc.cached('a', 1000, async () => {
      callCount++
      return 'value'
    })

    assert.equal(result, 'value')
    assert.equal(callCount, 1)
    assert.equal(cc.cacheSize, 1)
  })

  test('second call within TTL serves cached data', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async () => {
      callCount++
      return 'cached-value'
    }

    const first = await cc.cached('a', 1000, fn)
    const second = await cc.cached('a', 1000, fn)

    assert.equal(first, 'cached-value')
    assert.equal(second, 'cached-value')
    assert.equal(callCount, 1)
  })

  test('call after TTL expires re-executes fn', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    await cc.cached('a', 50, async () => {
      callCount++
      return 'v1'
    })

    assert.equal(callCount, 1)

    await sleep(60)

    const result = await cc.cached('a', 50, async () => {
      callCount++
      return 'v2'
    })

    assert.equal(callCount, 2)
    assert.equal(result, 'v2')
  })

  test('cache miss with concurrent calls coalesces', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    // Prime and expire the cache
    await cc.cached('a', 50, async () => {
      callCount++
      return 'stale'
    })

    assert.equal(callCount, 1)

    await sleep(60)

    // Fire 10 concurrent calls after cache expired
    const fn = async () => {
      callCount++
      await sleep(20)
      return 'fresh'
    }

    const promises = Array.from({ length: 10 }, () => cc.cached('a', 1000, fn))
    const results = await Promise.all(promises)

    // Only 1 extra execution (the coalesced one), so 2 total
    assert.equal(callCount, 2)
    for (const r of results) {
      assert.equal(r, 'fresh')
    }
  })

  test('different keys are cached independently', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCountA = 0
    let callCountB = 0

    const resultA = await cc.cached('a', 1000, async () => {
      callCountA++
      return 'alpha'
    })

    const resultB = await cc.cached('b', 1000, async () => {
      callCountB++
      return 'beta'
    })

    assert.equal(callCountA, 1)
    assert.equal(callCountB, 1)
    assert.equal(resultA, 'alpha')
    assert.equal(resultB, 'beta')
    assert.equal(cc.cacheSize, 2)
  })
})

// ---------------------------------------------------------------------------
// Stress / perf tests
// ---------------------------------------------------------------------------

test.group('CoalesceCache | stress', () => {
  test('100 concurrent coalesce calls — fn executes only once', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async () => {
      callCount++
      await sleep(30)
      return 'one-shot'
    }

    const promises = Array.from({ length: 100 }, () => cc.coalesce('endpoint', fn))
    const results = await Promise.all(promises)

    assert.equal(callCount, 1)
    for (const r of results) {
      assert.equal(r, 'one-shot')
    }
    assert.equal(cc.inflightSize, 0)
  })

  test('mixed concurrent + cached — maximum 1 execution per TTL window', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async () => {
      callCount++
      await sleep(5)
      return `result-${callCount}`
    }

    const ttl = 100

    // Burst at t=0: 50 requests
    const burst0 = Array.from({ length: 50 }, () => cc.cached('key', ttl, fn))

    // Burst at t=10ms: 50 requests (should all hit cache from first burst)
    await sleep(10)
    const burst1 = Array.from({ length: 50 }, () => cc.cached('key', ttl, fn))

    // Burst at t=20ms: 50 requests (should all still hit cache)
    await sleep(10)
    const burst2 = Array.from({ length: 50 }, () => cc.cached('key', ttl, fn))

    const allResults = await Promise.all([...burst0, ...burst1, ...burst2])

    // fn should have executed at most once across all 150 calls
    assert.equal(callCount, 1)
    for (const r of allResults) {
      assert.equal(r, 'result-1')
    }
  })
})
