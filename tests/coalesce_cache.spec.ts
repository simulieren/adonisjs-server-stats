import { test } from '@japa/runner'
import { CoalesceCache } from '../src/dashboard/coalesce_cache.js'

// ---------------------------------------------------------------------------
// CoalesceCache — in-flight coalescing + short-lived result caching
// ---------------------------------------------------------------------------

test.group('CoalesceCache', () => {
  test('coalesce returns same promise for concurrent calls with same key', async ({ assert }) => {
    const cache = new CoalesceCache()
    let callCount = 0

    const fn = () => {
      callCount++
      return new Promise<number>((resolve) => setTimeout(() => resolve(42), 10))
    }

    const [a, b, c] = await Promise.all([
      cache.coalesce('key1', fn),
      cache.coalesce('key1', fn),
      cache.coalesce('key1', fn),
    ])

    assert.equal(a, 42)
    assert.equal(b, 42)
    assert.equal(c, 42)
    assert.equal(callCount, 1) // Only one execution despite 3 calls
  })

  test('coalesce allows new execution after previous completes', async ({ assert }) => {
    const cache = new CoalesceCache()
    let callCount = 0

    const fn = () => {
      callCount++
      return Promise.resolve(callCount)
    }

    const first = await cache.coalesce('key1', fn)
    const second = await cache.coalesce('key1', fn)

    assert.equal(first, 1)
    assert.equal(second, 2)
    assert.equal(callCount, 2)
  })

  test('coalesce cleans up after rejection', async ({ assert }) => {
    const cache = new CoalesceCache()

    const failing = cache.coalesce('key1', () => Promise.reject(new Error('fail')))
    await assert.rejects(() => failing, 'fail')

    // After failure, a new call should work fine
    const result = await cache.coalesce('key1', () => Promise.resolve('ok'))
    assert.equal(result, 'ok')
  })

  test('coalesce handles different keys independently', async ({ assert }) => {
    const cache = new CoalesceCache()

    const [a, b] = await Promise.all([
      cache.coalesce('key1', () => Promise.resolve('one')),
      cache.coalesce('key2', () => Promise.resolve('two')),
    ])

    assert.equal(a, 'one')
    assert.equal(b, 'two')
  })

  test('cached returns cached value within TTL', async ({ assert }) => {
    const cache = new CoalesceCache()
    let callCount = 0

    const fn = () => {
      callCount++
      return Promise.resolve(callCount)
    }

    const first = await cache.cached('key1', 10_000, fn)
    const second = await cache.cached('key1', 10_000, fn)

    assert.equal(first, 1)
    assert.equal(second, 1) // Served from cache
    assert.equal(callCount, 1)
  })

  test('cached re-fetches after TTL expires', async ({ assert }) => {
    const cache = new CoalesceCache()
    let callCount = 0

    const fn = () => {
      callCount++
      return Promise.resolve(callCount)
    }

    const first = await cache.cached('key1', 1, fn) // 1ms TTL
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    const second = await cache.cached('key1', 1, fn)

    assert.equal(first, 1)
    assert.equal(second, 2)
    assert.equal(callCount, 2)
  })

  test('cached concurrent calls coalesce into one execution', async ({ assert }) => {
    const cache = new CoalesceCache()
    let callCount = 0

    const fn = () => {
      callCount++
      return new Promise<number>((resolve) => setTimeout(() => resolve(42), 10))
    }

    const [a, b] = await Promise.all([
      cache.cached('key1', 10_000, fn),
      cache.cached('key1', 10_000, fn),
    ])

    assert.equal(a, 42)
    assert.equal(b, 42)
    assert.equal(callCount, 1)
  })

  test('clearCache removes all cached entries', async ({ assert }) => {
    const cache = new CoalesceCache()
    let callCount = 0

    const fn = () => {
      callCount++
      return Promise.resolve(callCount)
    }

    await cache.cached('key1', 10_000, fn)
    cache.clearCache()
    const second = await cache.cached('key1', 10_000, fn)

    assert.equal(second, 2)
    assert.equal(callCount, 2)
  })
})
