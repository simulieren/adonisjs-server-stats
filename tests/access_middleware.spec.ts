import { test } from '@japa/runner'
import { createAccessMiddleware } from '../src/routes/access_middleware.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx() {
  let responseStatus = 200
  let responseBody: any = null
  return {
    response: {
      status(code: number) {
        responseStatus = code
        return this
      },
      send(body: any) {
        responseBody = body
      },
      forbidden(body: any) {
        responseStatus = 403
        responseBody = body
      },
    },
    _status: () => responseStatus,
    _body: () => responseBody,
  }
}

// ---------------------------------------------------------------------------
// createAccessMiddleware
// ---------------------------------------------------------------------------

test.group('createAccessMiddleware | shouldShow returns true', () => {
  test('next() is called and no 403 is returned', async ({ assert }) => {
    const middleware = createAccessMiddleware(() => true)
    const ctx = createMockCtx()
    let nextCalled = false

    await middleware(ctx as any, async () => {
      nextCalled = true
    })

    assert.isTrue(nextCalled)
    assert.equal(ctx._status(), 200)
    assert.isNull(ctx._body())
  })
})

test.group('createAccessMiddleware | shouldShow returns false', () => {
  test('returns 403 and next() is NOT called', async ({ assert }) => {
    const middleware = createAccessMiddleware(() => false)
    const ctx = createMockCtx()
    let nextCalled = false

    await middleware(ctx as any, async () => {
      nextCalled = true
    })

    assert.isFalse(nextCalled)
    assert.equal(ctx._status(), 403)
    assert.deepEqual(ctx._body(), { error: 'Access denied' })
  })
})

test.group('createAccessMiddleware | async shouldShow', () => {
  test('shouldShow returns Promise<true> — next() is called', async ({ assert }) => {
    const middleware = createAccessMiddleware((async () => true) as any)
    const ctx = createMockCtx()
    let nextCalled = false

    await middleware(ctx as any, async () => {
      nextCalled = true
    })

    // Note: createAccessMiddleware does `if (!shouldShow(ctx))` without await,
    // so a Promise (truthy) will always pass. This tests the actual behavior.
    assert.isTrue(nextCalled)
    assert.equal(ctx._status(), 200)
  })

  test('shouldShow returns Promise<false> — still passes because Promise is truthy', async ({
    assert,
  }) => {
    // A Promise object is truthy regardless of its resolved value,
    // so `!shouldShow(ctx)` is false and the guard passes through.
    const middleware = createAccessMiddleware((async () => false) as any)
    const ctx = createMockCtx()
    let nextCalled = false

    await middleware(ctx as any, async () => {
      nextCalled = true
    })

    // The middleware does not await shouldShow, so Promise<false> is truthy
    assert.isTrue(nextCalled)
    assert.equal(ctx._status(), 200)
  })
})

test.group('createAccessMiddleware | shouldShow throws & warn-once', (group) => {
  // The module-level `warnedShouldShow` flag persists across the entire test
  // process, so all error/warn-once tests must live in a single group that
  // controls ordering.

  let originalWarn: typeof console.warn
  let warnMessages: string[]

  group.setup(() => {
    originalWarn = console.warn
  })

  group.teardown(() => {
    console.warn = originalWarn
  })

  group.each.setup(() => {
    warnMessages = []
    console.warn = (...args: any[]) => {
      warnMessages.push(args.join(' '))
    }
  })

  test('returns 403 when shouldShow throws, and first exception logs a warning', async ({
    assert,
  }) => {
    const middleware = createAccessMiddleware(() => {
      throw new Error('boom')
    })
    const ctx = createMockCtx()
    let nextCalled = false

    await middleware(ctx as any, async () => {
      nextCalled = true
    })

    // Should return 403 and not call next
    assert.isFalse(nextCalled)
    assert.equal(ctx._status(), 403)
    assert.deepEqual(ctx._body(), { error: 'Access denied' })

    // The first exception should have produced a console.warn
    assert.isAbove(warnMessages.length, 0)
    assert.isTrue(warnMessages.some((m) => m.includes('shouldShow callback threw')))
  })

  test('subsequent exceptions do NOT log again (warn-once)', async ({ assert }) => {
    // The warnedShouldShow flag was already set to true by the previous test.
    // Subsequent throws should still return 403 but NOT log any more warnings.
    const middleware = createAccessMiddleware(() => {
      throw new Error('second boom')
    })
    const ctx1 = createMockCtx()
    const ctx2 = createMockCtx()

    await middleware(ctx1 as any, async () => {})
    await middleware(ctx2 as any, async () => {})

    // No new warnings should have been logged
    assert.equal(warnMessages.length, 0)

    // Both should still return 403
    assert.equal(ctx1._status(), 403)
    assert.equal(ctx2._status(), 403)
  })
})

test.group('createAccessMiddleware | next() is awaited', () => {
  test('the middleware awaits the return value of next()', async ({ assert }) => {
    const middleware = createAccessMiddleware(() => true)
    const ctx = createMockCtx()
    const order: string[] = []

    await middleware(ctx as any, async () => {
      // Simulate an async next() that takes time
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push('next-completed')
    })

    order.push('after-middleware')

    // If next() is properly awaited, 'next-completed' comes before 'after-middleware'
    assert.deepEqual(order, ['next-completed', 'after-middleware'])
  })
})
