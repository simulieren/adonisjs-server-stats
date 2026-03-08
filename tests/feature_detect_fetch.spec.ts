import { test } from '@japa/runner'
import {
  DEFAULT_FEATURES,
  detectFeatures,
} from '../src/core/feature-detect.js'

import type { FeatureFlags } from '../src/core/types.js'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildFlagsForFetch(
  overrides: Partial<FeatureFlags> = {}
): FeatureFlags {
  return {
    features: {
      statsBar: false,
      debugPanel: false,
      dashboard: false,
      tracing: false,
      process: false,
      system: false,
      http: false,
      db: false,
      redis: false,
      queues: false,
      cache: false,
      app: false,
      log: false,
      emails: false,
      ...overrides.features,
    },
    customPanes: overrides.customPanes ?? [],
    endpoints: overrides.endpoints ?? { stats: '', debug: '', dashboard: '' },
    transmit: overrides.transmit ?? { channelName: '' },
  }
}

// ---------------------------------------------------------------------------
// detectFeatures — fetch failures
// ---------------------------------------------------------------------------

test.group('detectFeatures | fetch failures', (group) => {
  let originalFetch: typeof globalThis.fetch

  group.setup(() => {
    originalFetch = globalThis.fetch
  })

  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('returns DEFAULT_FEATURES when fetch throws', async ({ assert }) => {
    globalThis.fetch = (() => {
      throw new Error('network failure')
    }) as unknown as Record<string, unknown>

    const result = await detectFeatures({ baseUrl: 'http://localhost:3333' })
    assert.deepEqual(result, DEFAULT_FEATURES)
  })

  test('returns DEFAULT_FEATURES when fetch rejects', async ({ assert }) => {
    globalThis.fetch = (async () => {
      throw new Error('connection refused')
    }) as unknown as Record<string, unknown>

    const result = await detectFeatures({ baseUrl: 'http://localhost:3333' })
    assert.deepEqual(result, DEFAULT_FEATURES)
  })

  test('returns DEFAULT_FEATURES when fetch returns non-OK response', async ({ assert }) => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Internal Server Error',
      } as Response
    }) as typeof globalThis.fetch

    const result = await detectFeatures({ baseUrl: 'http://localhost:3333' })
    assert.deepEqual(result, DEFAULT_FEATURES)
  })
})

// ---------------------------------------------------------------------------
// detectFeatures — successful responses
// ---------------------------------------------------------------------------

const MIXED_FLAGS_RESPONSE: FeatureFlags = buildFlagsForFetch({
  features: {
    statsBar: true, debugPanel: true, dashboard: true, tracing: true,
    process: true, system: false, http: true, db: true,
    redis: false, queues: false, cache: true, app: false, log: true, emails: false,
  },
  customPanes: [],
  endpoints: { stats: '/api/stats', debug: '/api/debug', dashboard: '/api/dashboard' },
  transmit: { channelName: 'stats' },
})

function mockOkFetch(response: FeatureFlags) {
  globalThis.fetch = (async () => ({
    ok: true, status: 200,
    json: async () => response,
    text: async () => JSON.stringify(response),
  } as Response)) as typeof globalThis.fetch
}

test.group('detectFeatures | flattened config response', (group) => {
  let originalFetch: typeof globalThis.fetch

  group.setup(() => {
    originalFetch = globalThis.fetch
  })

  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('returns flattened config on successful response', async ({ assert }) => {
    mockOkFetch(MIXED_FLAGS_RESPONSE)
    const result = await detectFeatures({ baseUrl: 'http://localhost:3333' })

    assert.isTrue(result.tracing)
    assert.isTrue(result.process)
    assert.isFalse(result.system)
    assert.isTrue(result.http)
    assert.isTrue(result.db)
    assert.isFalse(result.redis)
    assert.isFalse(result.queues)
    assert.isTrue(result.cache)
    assert.isFalse(result.app)
    assert.isTrue(result.log)
    assert.isFalse(result.emails)
    assert.isTrue(result.dashboard)
    assert.deepEqual(result.customPanes, [])
  })
})

test.group('detectFeatures | default options', (group) => {
  let originalFetch: typeof globalThis.fetch

  group.setup(() => {
    originalFetch = globalThis.fetch
  })

  group.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('uses default options when none provided', async ({ assert }) => {
    let capturedUrl = ''

    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return {
        ok: true,
        status: 200,
        json: async () => buildFlagsForFetch(),
        text: async () => '{}',
      } as Response
    }) as typeof globalThis.fetch

    const result = await detectFeatures({})

    assert.include(capturedUrl, '/admin/api/debug/config')
    assert.deepEqual(result.customPanes, [])
  })
})
