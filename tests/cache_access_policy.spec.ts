import { test } from '@japa/runner'

import {
  handleCacheKey,
  handleCacheKeyDelete,
  handleCacheStats,
} from '../src/dashboard/cache_handlers.js'

import type { CacheAccessPolicy } from '../src/dashboard/cache_handlers.js'

/** Minimal InspectorManager double with a working cache inspector. */
function fakeInspectors(listed: { pattern?: string } = {}) {
  return {
    async getCacheInspector() {
      return {
        async getKey(key: string) {
          return { key, value: 'v' }
        },
        async deleteKey() {
          return true
        },
        async getStats() {
          return {}
        },
        async listKeys(pattern: string) {
          listed.pattern = pattern
          return { keys: [], cursor: '0' }
        },
      }
    },
  } as any
}

/** Minimal HttpContext double capturing the response outcome. */
function fakeCtx(key = 'app:cache:foo') {
  const out: { status?: string; body?: unknown } = {}
  return {
    out,
    ctx: {
      params: { key: encodeURIComponent(key) },
      request: { qs: () => ({}) },
      response: {
        json(body: unknown) {
          out.status = 'ok'
          out.body = body
        },
        forbidden(body: unknown) {
          out.status = 'forbidden'
          out.body = body
        },
        notFound(body: unknown) {
          out.status = 'notFound'
          out.body = body
        },
        internalServerError(body: unknown) {
          out.status = 'error'
          out.body = body
        },
      },
    } as any,
  }
}

const dev = (prefix = ''): CacheAccessPolicy => ({ prefix, inProduction: false })
const prod = (prefix = ''): CacheAccessPolicy => ({ prefix, inProduction: true })

test.group('cache access policy', () => {
  test('dev without a prefix stays unrestricted (back-compat)', async ({ assert }) => {
    const { ctx, out } = fakeCtx('anything:at:all')
    await handleCacheKey(fakeInspectors(), ctx, dev())
    assert.equal(out.status, 'ok')
  })

  test('production without a prefix fails closed for reads and deletes', async ({ assert }) => {
    const read = fakeCtx()
    await handleCacheKey(fakeInspectors(), read.ctx, prod())
    assert.equal(read.out.status, 'forbidden')

    const del = fakeCtx()
    await handleCacheKeyDelete(fakeInspectors(), del.ctx, prod())
    assert.equal(del.out.status, 'forbidden')
  })

  test('a configured prefix allows matching keys and refuses others', async ({ assert }) => {
    const okRead = fakeCtx('app:cache:users')
    await handleCacheKey(fakeInspectors(), okRead.ctx, prod('app:cache:'))
    assert.equal(okRead.out.status, 'ok')

    const denied = fakeCtx('session:abc123')
    await handleCacheKey(fakeInspectors(), denied.ctx, prod('app:cache:'))
    assert.equal(denied.out.status, 'forbidden')

    const deniedDelete = fakeCtx('ratelimit:ip:1.2.3.4')
    await handleCacheKeyDelete(fakeInspectors(), deniedDelete.ctx, dev('app:cache:'))
    assert.equal(deniedDelete.out.status, 'forbidden')
  })

  test('a configured prefix scopes the listing glob', async ({ assert }) => {
    const listed: { pattern?: string } = {}
    const { ctx } = fakeCtx()
    await handleCacheStats(fakeInspectors(listed), ctx, prod('app:cache:'))
    assert.equal(listed.pattern, 'app:cache:*')
  })
})
