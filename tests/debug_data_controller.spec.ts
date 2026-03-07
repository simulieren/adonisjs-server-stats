import { test } from '@japa/runner'
import { DebugDataController } from '../src/core/debug-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

/**
 * Create a mock for `globalThis.fetch` that returns JSON responses
 * keyed by the full URL string.  An optional delay simulates network
 * latency and honours `AbortSignal` during the wait.
 */
function mockFetch(responses: Record<string, unknown>, delayMs: number = 0) {
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    if (delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timeout)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    }

    const urlStr = typeof url === 'string' ? url : url.toString()
    return new Response(JSON.stringify(responses[urlStr] ?? { tab: urlStr }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * Build a tracking object for all controller callbacks.
 */
function createCallbacks() {
  const calls = {
    data: [] as unknown[],
    loading: [] as boolean[],
    errors: [] as (Error | null)[],
    unauthorized: [] as unknown[],
  }
  return {
    calls,
    onData: (d: unknown) => calls.data.push(d),
    onLoading: (l: boolean) => calls.loading.push(l),
    onError: (e: Error | null) => calls.errors.push(e),
    onUnauthorized: (e: unknown) => calls.unauthorized.push(e),
  }
}

/**
 * Small async helper — wait for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a controller with sensible test defaults.
 */
function createController(
  callbacks: ReturnType<typeof createCallbacks>,
  overrides: Partial<{ refreshInterval: number }> = {}
) {
  return new DebugDataController({
    baseUrl: '',
    ...callbacks,
    refreshInterval: overrides.refreshInterval ?? 60_000, // long default so timers don't interfere
  })
}

// ---------------------------------------------------------------------------
// Tests — Fetch cancellation
// ---------------------------------------------------------------------------

test.group('DebugDataController | fetch cancellation', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('start() triggers a fetch and calls onLoading then onData', async ({ assert }) => {
    const { calls, ...cbs } = createCallbacks()

    mockFetch(
      { '/admin/api/debug/queries': { result: 'queries-data' } },
      10
    )

    const ctrl = createController({ calls, ...cbs })
    ctrl.start('queries')

    // onLoading(true) is called synchronously by start()
    assert.deepEqual(calls.loading, [true])

    // Wait for the fetch to complete
    await sleep(50)

    assert.isTrue(calls.data.length >= 1)
    assert.deepEqual(calls.data[0], { result: 'queries-data' })

    ctrl.stop()
  })

  test('rapid start() calls cancel previous fetches — only the last tab data arrives', async ({
    assert,
  }) => {
    const { calls, ...cbs } = createCallbacks()

    mockFetch(
      {
        '/admin/api/debug/queries': { tab: 'queries' },
        '/admin/api/debug/events': { tab: 'events' },
        '/admin/api/debug/logs': { tab: 'logs' },
      },
      100
    )

    const ctrl = createController({ calls, ...cbs })

    // Fire three starts in quick succession — each should abort the previous
    ctrl.start('queries')
    ctrl.start('events')
    ctrl.start('logs')

    // Wait enough for the last fetch to complete
    await sleep(250)

    // Only the logs data should arrive
    const tabsReceived = calls.data.map((d: any) => d.tab)
    assert.deepEqual(tabsReceived, ['logs'])

    ctrl.stop()
  })

  test('stop() aborts in-flight fetch — onData is not called', async ({ assert }) => {
    const { calls, ...cbs } = createCallbacks()

    mockFetch({ '/admin/api/debug/queries': { tab: 'queries' } }, 200)

    const ctrl = createController({ calls, ...cbs })
    ctrl.start('queries')

    // Give it a moment to start the fetch, then stop
    await sleep(10)
    ctrl.stop()

    // Wait beyond what the fetch would have taken
    await sleep(300)

    assert.lengthOf(calls.data, 0)
  })

  test('switchTab cancels previous and fetches new tab data', async ({ assert }) => {
    const { calls, ...cbs } = createCallbacks()

    mockFetch(
      {
        '/admin/api/debug/queries': { tab: 'queries' },
        '/admin/api/debug/events': { tab: 'events' },
      },
      100
    )

    const ctrl = createController({ calls, ...cbs })
    ctrl.start('queries')
    // Switch before the queries fetch resolves
    ctrl.switchTab('events')

    await sleep(250)

    const tabsReceived = calls.data.map((d: any) => d.tab)
    assert.deepEqual(tabsReceived, ['events'])

    ctrl.stop()
  })

  test('AbortError is silently ignored — onError is not called', async ({ assert }) => {
    const { calls, ...cbs } = createCallbacks()

    mockFetch({ '/admin/api/debug/queries': { tab: 'queries' } }, 200)

    const ctrl = createController({ calls, ...cbs })
    ctrl.start('queries')

    await sleep(10)
    ctrl.stop()

    await sleep(300)

    // onError should only have the initial null from start(), no AbortError
    const realErrors = calls.errors.filter((e) => e !== null)
    assert.lengthOf(realErrors, 0)
    assert.lengthOf(calls.unauthorized, 0)
  })
})

// ---------------------------------------------------------------------------
// Tests — Timer behaviour
// ---------------------------------------------------------------------------

test.group('DebugDataController | timer behaviour', (group) => {
  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('auto-refresh timer fires periodically', async ({ assert }) => {
    const { calls, ...cbs } = createCallbacks()

    mockFetch({ '/admin/api/debug/queries': { tab: 'queries' } }, 0)

    // Use a very short refresh interval for testing
    const ctrl = createController({ calls, ...cbs }, { refreshInterval: 50 })
    ctrl.start('queries')

    // Wait long enough for several intervals to fire
    await sleep(250)

    ctrl.stop()

    // The first fetch fires immediately from start(), then the timer fires
    // additional fetches.  We should see more than 1 onData call.
    assert.isTrue(
      calls.data.length >= 3,
      `Expected at least 3 data callbacks but got ${calls.data.length}`
    )
  })

  test('stop() clears the refresh timer — no more fetches after stop', async ({ assert }) => {
    const { calls, ...cbs } = createCallbacks()

    let fetchCount = 0
    const origMock = globalThis.fetch
    mockFetch({ '/admin/api/debug/queries': { tab: 'queries' } }, 0)
    const mockedFetch = globalThis.fetch
    globalThis.fetch = async (...args: Parameters<typeof globalThis.fetch>) => {
      fetchCount++
      return mockedFetch(...args)
    }

    const ctrl = createController({ calls, ...cbs }, { refreshInterval: 50 })
    ctrl.start('queries')

    // Let the first fetch complete and one timer tick
    await sleep(80)
    ctrl.stop()

    const countAtStop = fetchCount

    // Wait to see if any more fetches occur
    await sleep(200)

    assert.equal(
      fetchCount,
      countAtStop,
      `Fetch count should not increase after stop() — was ${countAtStop}, now ${fetchCount}`
    )
  })
})
