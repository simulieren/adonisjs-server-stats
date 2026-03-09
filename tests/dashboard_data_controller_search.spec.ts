import { test } from '@japa/runner'
import { DashboardDataController } from '../src/core/dashboard-data-controller.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

/**
 * Create a mock for `globalThis.fetch` that captures requests and returns
 * JSON responses. The response handler receives the full URL so tests can
 * assert which query parameters were sent.
 */
function mockFetch(handler: (url: string) => unknown) {
  const requests: string[] = []
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    const urlStr = typeof url === 'string' ? url : url.toString()
    requests.push(urlStr)
    const body = handler(urlStr)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return requests
}

/**
 * Build a tracking object for all controller callbacks.
 */
function createCallbacks() {
  const calls = {
    data: [] as unknown[],
    pagination: [] as unknown[],
    loading: [] as boolean[],
    errors: [] as (Error | null)[],
    unauthorized: 0,
  }
  return {
    calls,
    callbacks: {
      onData: (d: unknown) => calls.data.push(d),
      onPagination: (m: unknown) => calls.pagination.push(m),
      onLoading: (l: boolean) => calls.loading.push(l),
      onError: (e: Error | null) => calls.errors.push(e),
      onUnauthorized: () => {
        calls.unauthorized++
      },
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a controller with sensible test defaults.
 */
function createController(callbacks: ReturnType<typeof createCallbacks>['callbacks']) {
  return new DashboardDataController({
    baseUrl: '',
    endpoint: '/__stats/api',
    authToken: undefined,
    section: 'events',
    perPage: 50,
    callbacks,
  })
}

/**
 * Simulate the React hook pattern: stop → configure → start/fetch.
 * This mirrors what useDashboardData's useEffect does on param changes.
 */
function simulateReactParamChange(
  ctrl: DashboardDataController,
  params: { search?: string; page?: number }
) {
  // 1. useEffect cleanup calls stop()
  ctrl.stop()
  // 2. syncAndFetch calls configure() then start()
  ctrl.configure(params)
  ctrl.start()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.group('DashboardDataController search', (group) => {
  group.each.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('search parameter is included in the API request URL', async ({ assert }) => {
    const requests = mockFetch(() => ({
      data: [],
      meta: { total: 0, perPage: 50, currentPage: 1, lastPage: 1 },
    }))
    const { callbacks } = createCallbacks()
    const ctrl = createController(callbacks)

    ctrl.configure({ search: 'hello' })
    ctrl.start()
    await sleep(50)
    ctrl.stop()

    assert.isTrue(requests.some((r) => r.includes('search=hello')))
  })

  test('changing search triggers a new fetch with updated query', async ({ assert }) => {
    const requests = mockFetch(() => ({
      data: [{ id: 1 }],
      meta: { total: 1, perPage: 50, currentPage: 1, lastPage: 1 },
    }))
    const { callbacks, calls } = createCallbacks()
    const ctrl = createController(callbacks)

    // Initial fetch
    ctrl.start()
    await sleep(50)

    // Simulate React search change: stop → configure → start
    simulateReactParamChange(ctrl, { search: 'test-query' })
    await sleep(50)
    ctrl.stop()

    // Should have at least 2 requests: initial + search
    assert.isAbove(requests.length, 1)
    const searchRequest = requests.find((r) => r.includes('search=test-query'))
    assert.isDefined(searchRequest, 'Expected a request with search=test-query')
  })

  test('data callback fires after search change (not discarded as stale)', async ({ assert }) => {
    let callCount = 0
    const requests = mockFetch(() => {
      callCount++
      return {
        data: [{ id: callCount, name: `result-${callCount}` }],
        meta: { total: 1, perPage: 50, currentPage: 1, lastPage: 1 },
      }
    })
    const { callbacks, calls } = createCallbacks()
    const ctrl = createController(callbacks)

    // Initial fetch
    ctrl.start()
    await sleep(50)

    // Data should have been set at least once
    const dataBeforeSearch = calls.data.length
    assert.isAbove(dataBeforeSearch, 0, 'Initial fetch should produce data')

    // Simulate search change
    simulateReactParamChange(ctrl, { search: 'foo' })
    await sleep(50)
    ctrl.stop()

    // Data should have been updated again after search
    assert.isAbove(calls.data.length, dataBeforeSearch, 'Search should trigger new data callback')
  })

  test('stop then start resets the stopped flag so responses are not discarded', async ({
    assert,
  }) => {
    const requests = mockFetch(() => ({
      data: [{ id: 1 }],
      meta: { total: 1, perPage: 50, currentPage: 1, lastPage: 1 },
    }))
    const { callbacks, calls } = createCallbacks()
    const ctrl = createController(callbacks)

    // Start, wait, stop
    ctrl.start()
    await sleep(50)
    ctrl.stop()

    const dataAfterStop = calls.data.length

    // Start again (simulating what useEffect does)
    ctrl.start()
    await sleep(50)
    ctrl.stop()

    // Data should have been updated again — not discarded
    assert.isAbove(calls.data.length, dataAfterStop, 'Restarted controller should produce data')
  })

  test('multiple search changes each produce data updates', async ({ assert }) => {
    let counter = 0
    mockFetch((url) => {
      counter++
      const search = new URL(url, 'http://localhost').searchParams.get('search') || 'none'
      return {
        data: [{ id: counter, search }],
        meta: { total: 1, perPage: 50, currentPage: 1, lastPage: 1 },
      }
    })
    const { callbacks, calls } = createCallbacks()
    const ctrl = createController(callbacks)

    // Initial
    ctrl.start()
    await sleep(50)

    // Search 1
    simulateReactParamChange(ctrl, { search: 'alpha' })
    await sleep(50)

    // Search 2
    simulateReactParamChange(ctrl, { search: 'beta' })
    await sleep(50)

    // Search 3
    simulateReactParamChange(ctrl, { search: 'gamma' })
    await sleep(50)

    ctrl.stop()

    // Should have at least 4 data updates (initial + 3 searches)
    assert.isAtLeast(calls.data.length, 4, 'Each search should produce a data update')
  })

  test('clearing search (empty string) fetches without search param', async ({ assert }) => {
    const requests = mockFetch(() => ({
      data: [],
      meta: { total: 0, perPage: 50, currentPage: 1, lastPage: 1 },
    }))
    const { callbacks } = createCallbacks()
    const ctrl = createController(callbacks)

    ctrl.start()
    await sleep(50)

    // Set search
    simulateReactParamChange(ctrl, { search: 'test' })
    await sleep(50)

    // Clear search
    simulateReactParamChange(ctrl, { search: '' })
    await sleep(50)
    ctrl.stop()

    // Last request should not contain search param
    const lastRequest = requests[requests.length - 1]
    assert.isFalse(
      lastRequest.includes('search='),
      'Cleared search should not include search param'
    )
  })

  test('search change resets to page 1 via configure', async ({ assert }) => {
    const requests = mockFetch(() => ({
      data: [],
      meta: { total: 100, perPage: 10, currentPage: 1, lastPage: 10 },
    }))
    const { callbacks } = createCallbacks()
    const ctrl = createController(callbacks)

    // Start on page 3
    ctrl.configure({ page: 3 })
    ctrl.start()
    await sleep(50)

    // Change search — host component resets page to 1
    simulateReactParamChange(ctrl, { search: 'newterm', page: 1 })
    await sleep(50)
    ctrl.stop()

    const searchRequest = requests.find((r) => r.includes('search=newterm'))
    assert.isDefined(searchRequest)
    // Page should be 1 in the search request
    const url = new URL(searchRequest!, 'http://localhost')
    assert.equal(url.searchParams.get('page'), '1')
  })

  test('loading state transitions correctly during search', async ({ assert }) => {
    mockFetch(() => ({
      data: [{ id: 1 }],
      meta: { total: 1, perPage: 50, currentPage: 1, lastPage: 1 },
    }))
    const { callbacks, calls } = createCallbacks()
    const ctrl = createController(callbacks)

    ctrl.start()
    await sleep(50)

    // After initial fetch, loading should end with false
    assert.isFalse(calls.loading[calls.loading.length - 1])

    // Search triggers a new non-silent fetch via start()
    simulateReactParamChange(ctrl, { search: 'x' })
    await sleep(50)
    ctrl.stop()

    // Loading should have gone true → false for the search fetch
    const lastTwo = calls.loading.slice(-2)
    assert.deepEqual(lastTwo, [true, false])
  })
})
