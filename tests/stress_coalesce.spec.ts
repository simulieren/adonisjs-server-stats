import { test } from '@japa/runner'
import { RingBuffer } from '../src/debug/ring_buffer.js'

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
// Stress | coalesce thundering herd
// ---------------------------------------------------------------------------

test.group('Stress | coalesce thundering herd', () => {
  test('1000 concurrent coalesce calls — fn executes exactly once', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async () => {
      callCount++
      await sleep(5)
      return 'thundering-herd-result'
    }

    const promises = Array.from({ length: 1000 }, () => cc.coalesce('endpoint', fn))
    const results = await Promise.all(promises)

    assert.equal(callCount, 1)
    for (const r of results) {
      assert.equal(r, 'thundering-herd-result')
    }
  })

  test('1000 concurrent calls across 10 different keys — each key executes once', async ({
    assert,
  }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async (key: string) => {
      callCount++
      await sleep(5)
      return `result-${key}`
    }

    const promises: Promise<string>[] = []
    for (let k = 0; k < 10; k++) {
      const key = `key-${k}`
      for (let i = 0; i < 100; i++) {
        promises.push(cc.coalesce(key, () => fn(key)))
      }
    }

    const results = await Promise.all(promises)

    assert.equal(callCount, 10)

    // Verify each group of 100 got the correct result
    for (let k = 0; k < 10; k++) {
      const expected = `result-key-${k}`
      for (let i = 0; i < 100; i++) {
        assert.equal(results[k * 100 + i], expected)
      }
    }
  })

  test('rapid sequential bursts with caching — fn executes minimally', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async () => {
      callCount++
      await sleep(5)
      return 'burst-result'
    }

    const allPromises: Promise<string>[] = []

    for (let burst = 0; burst < 5; burst++) {
      const batch = Array.from({ length: 100 }, () => cc.cached('burst-key', 200, fn))
      allPromises.push(...batch)
      await sleep(10)
    }

    const results = await Promise.all(allPromises)

    assert.isAtMost(callCount, 1)
    for (const r of results) {
      assert.equal(r, 'burst-result')
    }
  })

  test('alternating keys under load — no cross-contamination', async ({ assert }) => {
    const cc = new CoalesceCache()

    const fn = async (key: string) => {
      await sleep(5)
      return `value-${key}`
    }

    const promises: { key: string; promise: Promise<string> }[] = []
    for (let i = 0; i < 500; i++) {
      const key = i % 2 === 0 ? 'a' : 'b'
      promises.push({ key, promise: cc.coalesce(key, () => fn(key)) })
    }

    const results = await Promise.all(promises.map((p) => p.promise))

    for (let i = 0; i < 500; i++) {
      const expectedKey = i % 2 === 0 ? 'a' : 'b'
      assert.equal(results[i], `value-${expectedKey}`)
    }
  })

  test('coalesce under error storm — errors do not poison future calls', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const failingFn = async () => {
      callCount++
      await sleep(5)
      throw new Error('storm-error')
    }

    // First batch: 100 concurrent calls — all should get the error
    const firstBatch = Array.from({ length: 100 }, () => cc.coalesce('stormy', failingFn))
    const firstResults = await Promise.allSettled(firstBatch)

    for (const r of firstResults) {
      assert.equal(r.status, 'rejected')
      assert.equal((r as PromiseRejectedResult).reason.message, 'storm-error')
    }

    assert.equal(cc.inflightSize, 0)

    // Second batch: 100 concurrent calls — should succeed
    const succeedingFn = async () => {
      callCount++
      await sleep(5)
      return 'recovered'
    }

    const secondBatch = Array.from({ length: 100 }, () => cc.coalesce('stormy', succeedingFn))
    const secondResults = await Promise.all(secondBatch)

    for (const r of secondResults) {
      assert.equal(r, 'recovered')
    }

    // First call (error) + second call (success) = 2 total
    assert.equal(callCount, 2)
  })

  test('cache expiry under sustained load — fn re-executes after TTL', async ({ assert }) => {
    const cc = new CoalesceCache()
    let callCount = 0

    const fn = async () => {
      callCount++
      return `exec-${callCount}`
    }

    // Burst at t=0
    const burst1 = Array.from({ length: 100 }, () => cc.cached('ttl-key', 50, fn))
    const results1 = await Promise.all(burst1)

    assert.equal(callCount, 1)
    for (const r of results1) {
      assert.equal(r, 'exec-1')
    }

    // Wait for cache to expire
    await sleep(60)

    // Burst at t=60ms
    const burst2 = Array.from({ length: 100 }, () => cc.cached('ttl-key', 50, fn))
    const results2 = await Promise.all(burst2)

    assert.equal(callCount, 2)
    for (const r of results2) {
      assert.equal(r, 'exec-2')
    }

    // 200 total promises resolved
    assert.equal(results1.length + results2.length, 200)
  })

  test('memory pressure — inflight map stays clean', async ({ assert }) => {
    const cc = new CoalesceCache()

    // Fire 1000 coalesce calls with unique keys
    const coalescePromises = Array.from({ length: 1000 }, (_, i) =>
      cc.coalesce(`unique-${i}`, async () => {
        await sleep(1)
        return i
      })
    )
    await Promise.all(coalescePromises)

    assert.equal(cc.inflightSize, 0)

    // Fire 1000 cached calls with unique keys
    const cachedPromises = Array.from({ length: 1000 }, (_, i) =>
      cc.cached(`cached-unique-${i}`, 5000, async () => {
        await sleep(1)
        return i
      })
    )
    await Promise.all(cachedPromises)

    assert.equal(cc.inflightSize, 0)
    assert.equal(cc.cacheSize, 1000)
  })
})

// ---------------------------------------------------------------------------
// Stress | RingBuffer under load
// ---------------------------------------------------------------------------

test.group('Stress | RingBuffer under load', () => {
  test('push 100,000 items into buffer of 500 — no corruption', async ({ assert }) => {
    const buffer = new RingBuffer<{ id: number; value: string }>(500)

    for (let i = 0; i < 100_000; i++) {
      const id = buffer.getNextId()
      buffer.push({ id, value: `item-${id}` })
    }

    assert.equal(buffer.size(), 500)

    const items = buffer.toArray()
    assert.equal(items.length, 500)

    // Items should be the last 500 pushed (IDs 99501..100000)
    for (let i = 0; i < 500; i++) {
      assert.equal(items[i].id, 99_501 + i)
      assert.equal(items[i].value, `item-${99_501 + i}`)
    }

    // IDs are monotonically increasing
    for (let i = 1; i < items.length; i++) {
      assert.isTrue(items[i].id > items[i - 1].id)
    }
  })

  test('collectFromEnd under rapid push — consistent results', async ({ assert }) => {
    const buffer = new RingBuffer<{ id: number; value: string }>(10_000)

    // Push 10000 items
    for (let i = 0; i < 10_000; i++) {
      const id = buffer.getNextId()
      buffer.push({ id, value: `item-${id}` })
    }

    const lastId = 10_000 // The last ID assigned

    // Push 50 more items
    for (let i = 0; i < 50; i++) {
      const id = buffer.getNextId()
      buffer.push({ id, value: `item-${id}` })
    }

    const collected = buffer.collectFromEnd((item) => item.id > lastId)
    assert.equal(collected.length, 50)

    // Verify IDs are sequential and match the expected range (10001..10050)
    for (let i = 0; i < 50; i++) {
      assert.equal(collected[i].id, lastId + 1 + i)
      assert.equal(collected[i].value, `item-${lastId + 1 + i}`)
    }

    // Verify sequential ordering
    for (let i = 1; i < collected.length; i++) {
      assert.equal(collected[i].id, collected[i - 1].id + 1)
    }
  })

  test('findFromEnd with 100,000 items — finds correct item', async ({ assert }) => {
    const buffer = new RingBuffer<{ id: number; value: string }>(500)

    for (let i = 0; i < 100_000; i++) {
      const id = buffer.getNextId()
      buffer.push({ id, value: `item-${id}` })
    }

    // ID 99500 is within the last 500 items (99501..100000)... actually 99500
    // is at position 0 of the retained window? Let's check: IDs 99501..100000
    // are retained. 99500 was overwritten.
    // Find an item that IS in the buffer
    const found = buffer.findFromEnd((item) => item.id === 99_750)
    assert.isDefined(found)
    assert.equal(found!.id, 99_750)
    assert.equal(found!.value, 'item-99750')

    // Find an item that was overwritten (should return undefined)
    const overwritten = buffer.findFromEnd((item) => item.id === 500)
    assert.isUndefined(overwritten)
  })
})
