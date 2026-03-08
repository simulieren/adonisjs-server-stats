import { test } from '@japa/runner'
import {
  DEFAULT_FEATURES,
  getVisibleMetricGroups,
  detectMetricGroupsFromStats,
  detectFeatures,
} from '../src/core/feature-detect.js'

import type { FeatureConfig, FeatureFlags } from '../src/core/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal FeatureConfig with all flags false, then override.
 */
function buildConfig(overrides: Partial<FeatureConfig> = {}): FeatureConfig {
  return {
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
    dashboard: false,
    customPanes: [],
    ...overrides,
  }
}

/**
 * Build a minimal nested FeatureFlags object with all flags false, then override.
 */
function buildFlags(
  overrides: Partial<FeatureFlags['features']> = {},
  customPanes: FeatureFlags['customPanes'] = []
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
      ...overrides,
    },
    customPanes,
    endpoints: { stats: '', debug: '', dashboard: '' },
    transmit: { channelName: '' },
  }
}

// ---------------------------------------------------------------------------
// DEFAULT_FEATURES
// ---------------------------------------------------------------------------

test.group('DEFAULT_FEATURES', () => {
  test('all feature flags default to false', ({ assert }) => {
    assert.isFalse(DEFAULT_FEATURES.tracing)
    assert.isFalse(DEFAULT_FEATURES.process)
    assert.isFalse(DEFAULT_FEATURES.system)
    assert.isFalse(DEFAULT_FEATURES.http)
    assert.isFalse(DEFAULT_FEATURES.db)
    assert.isFalse(DEFAULT_FEATURES.redis)
    assert.isFalse(DEFAULT_FEATURES.queues)
    assert.isFalse(DEFAULT_FEATURES.cache)
    assert.isFalse(DEFAULT_FEATURES.app)
    assert.isFalse(DEFAULT_FEATURES.log)
    assert.isFalse(DEFAULT_FEATURES.emails)
    assert.isFalse(DEFAULT_FEATURES.dashboard)
  })

  test('customPanes is an empty array', ({ assert }) => {
    assert.deepEqual(DEFAULT_FEATURES.customPanes, [])
    assert.isArray(DEFAULT_FEATURES.customPanes)
  })
})

// ---------------------------------------------------------------------------
// getVisibleMetricGroups — flat FeatureConfig
// ---------------------------------------------------------------------------

test.group('getVisibleMetricGroups | flat FeatureConfig', () => {
  test('all flags false returns empty set', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig())
    assert.equal(groups.size, 0)
  })

  test('process flag adds process and memory groups', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig({ process: true }))
    assert.isTrue(groups.has('process'))
    assert.isTrue(groups.has('memory'))
  })

  test('system flag adds memory group (but not process)', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig({ system: true }))
    assert.isTrue(groups.has('memory'))
    assert.isFalse(groups.has('process'))
  })

  test('http flag adds http group', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig({ http: true }))
    assert.isTrue(groups.has('http'))
    assert.equal(groups.size, 1)
  })

  test('db flag adds db group', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig({ db: true }))
    assert.isTrue(groups.has('db'))
    assert.equal(groups.size, 1)
  })

  test('redis flag adds redis group', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig({ redis: true }))
    assert.isTrue(groups.has('redis'))
    assert.equal(groups.size, 1)
  })

  test('queues flag adds queue group', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig({ queues: true }))
    assert.isTrue(groups.has('queue'))
    assert.equal(groups.size, 1)
  })

  test('app flag adds app group', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig({ app: true }))
    assert.isTrue(groups.has('app'))
    assert.equal(groups.size, 1)
  })

  test('log flag adds log group', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildConfig({ log: true }))
    assert.isTrue(groups.has('log'))
    assert.equal(groups.size, 1)
  })

  test('memory group is added when process OR system is true', ({ assert }) => {
    const processOnly = getVisibleMetricGroups(buildConfig({ process: true }))
    assert.isTrue(processOnly.has('memory'))

    const systemOnly = getVisibleMetricGroups(buildConfig({ system: true }))
    assert.isTrue(systemOnly.has('memory'))

    const both = getVisibleMetricGroups(buildConfig({ process: true, system: true }))
    assert.isTrue(both.has('memory'))

    const neither = getVisibleMetricGroups(buildConfig())
    assert.isFalse(neither.has('memory'))
  })

  test('multiple flags combine correctly', ({ assert }) => {
    const groups = getVisibleMetricGroups(
      buildConfig({ process: true, http: true, db: true, log: true })
    )
    assert.isTrue(groups.has('process'))
    assert.isTrue(groups.has('memory'))
    assert.isTrue(groups.has('http'))
    assert.isTrue(groups.has('db'))
    assert.isTrue(groups.has('log'))
    assert.equal(groups.size, 5)
  })
})

// ---------------------------------------------------------------------------
// getVisibleMetricGroups — nested FeatureFlags
// ---------------------------------------------------------------------------

test.group('getVisibleMetricGroups | nested FeatureFlags', () => {
  test('nested flags with process true adds process and memory', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildFlags({ process: true }))
    assert.isTrue(groups.has('process'))
    assert.isTrue(groups.has('memory'))
  })

  test('nested flags with http true adds http group', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildFlags({ http: true }))
    assert.isTrue(groups.has('http'))
  })

  test('nested flags all false returns empty set', ({ assert }) => {
    const groups = getVisibleMetricGroups(buildFlags())
    assert.equal(groups.size, 0)
  })
})

// ---------------------------------------------------------------------------
// detectMetricGroupsFromStats
// ---------------------------------------------------------------------------

test.group('detectMetricGroupsFromStats', () => {
  test('empty stats returns empty set', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({})
    assert.equal(groups.size, 0)
  })

  test('cpuPercent:0 adds process group (0 is a valid number)', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ cpuPercent: 0 })
    assert.isTrue(groups.has('process'))
  })

  test('cpuPercent:NaN does NOT add process group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ cpuPercent: NaN })
    assert.isFalse(groups.has('process'))
  })

  test('nodeVersion empty string does NOT add process group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ nodeVersion: '' })
    assert.isFalse(groups.has('process'))
  })

  test('nodeVersion non-empty string adds process group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ nodeVersion: 'v20.0.0' })
    assert.isTrue(groups.has('process'))
  })

  test('uptime adds process group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ uptime: 12345 })
    assert.isTrue(groups.has('process'))
  })

  test('memHeapUsed adds memory group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ memHeapUsed: 100 })
    assert.isTrue(groups.has('memory'))
  })

  test('memRss adds memory group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ memRss: 200 })
    assert.isTrue(groups.has('memory'))
  })

  test('systemMemoryTotalMb adds memory group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ systemMemoryTotalMb: 8192 })
    assert.isTrue(groups.has('memory'))
  })

  test('systemMemoryFreeMb adds memory group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ systemMemoryFreeMb: 4096 })
    assert.isTrue(groups.has('memory'))
  })

  test('requestsPerSecond adds http group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ requestsPerSecond: 50 })
    assert.isTrue(groups.has('http'))
  })

  test('avgResponseTimeMs adds http group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ avgResponseTimeMs: 12 })
    assert.isTrue(groups.has('http'))
  })

  test('errorRate adds http group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ errorRate: 0 })
    assert.isTrue(groups.has('http'))
  })

  test('activeHttpConnections adds http group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ activeHttpConnections: 5 })
    assert.isTrue(groups.has('http'))
  })

  test('dbPoolMax adds db group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ dbPoolMax: 10 })
    assert.isTrue(groups.has('db'))
  })

  test('dbPoolUsed adds db group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ dbPoolUsed: 3 })
    assert.isTrue(groups.has('db'))
  })

  test('dbPoolFree adds db group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ dbPoolFree: 7 })
    assert.isTrue(groups.has('db'))
  })

  test('dbPoolPending adds db group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ dbPoolPending: 0 })
    assert.isTrue(groups.has('db'))
  })

  test('redisOk:true adds redis group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ redisOk: true })
    assert.isTrue(groups.has('redis'))
  })

  test('redisOk:false adds redis group (collector is active)', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ redisOk: false })
    assert.isTrue(groups.has('redis'))
  })

  test('redisOk:undefined does NOT add redis group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ redisOk: undefined })
    assert.isFalse(groups.has('redis'))
  })

  test('redisOk:null does NOT add redis group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ redisOk: null })
    assert.isFalse(groups.has('redis'))
  })

  test('queueActive adds queue group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ queueActive: 2 })
    assert.isTrue(groups.has('queue'))
  })

  test('queueWaiting adds queue group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ queueWaiting: 0 })
    assert.isTrue(groups.has('queue'))
  })

  test('queueWorkerCount adds queue group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ queueWorkerCount: 4 })
    assert.isTrue(groups.has('queue'))
  })

  test('onlineUsers adds app group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ onlineUsers: 100 })
    assert.isTrue(groups.has('app'))
  })

  test('pendingWebhooks adds app group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ pendingWebhooks: 5 })
    assert.isTrue(groups.has('app'))
  })

  test('pendingEmails adds app group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ pendingEmails: 0 })
    assert.isTrue(groups.has('app'))
  })

  test('logErrorsLast5m adds log group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ logErrorsLast5m: 3 })
    assert.isTrue(groups.has('log'))
  })

  test('logEntriesPerMinute adds log group', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({ logEntriesPerMinute: 100 })
    assert.isTrue(groups.has('log'))
  })

  test('NaN values are excluded from all numeric checks', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({
      cpuPercent: NaN,
      memHeapUsed: NaN,
      requestsPerSecond: NaN,
      dbPoolMax: NaN,
      queueActive: NaN,
      onlineUsers: NaN,
      logErrorsLast5m: NaN,
    })
    assert.equal(groups.size, 0)
  })

  test('undefined values are excluded from all checks', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({
      cpuPercent: undefined,
      memHeapUsed: undefined,
      requestsPerSecond: undefined,
      dbPoolMax: undefined,
      redisOk: undefined,
      queueActive: undefined,
      onlineUsers: undefined,
      logErrorsLast5m: undefined,
    })
    assert.equal(groups.size, 0)
  })

  test('full stats snapshot adds all groups', ({ assert }) => {
    const groups = detectMetricGroupsFromStats({
      cpuPercent: 45,
      memHeapUsed: 100,
      systemMemoryTotalMb: 16384,
      requestsPerSecond: 200,
      dbPoolMax: 20,
      redisOk: true,
      queueActive: 3,
      onlineUsers: 50,
      logErrorsLast5m: 1,
    })
    assert.isTrue(groups.has('process'))
    assert.isTrue(groups.has('memory'))
    assert.isTrue(groups.has('http'))
    assert.isTrue(groups.has('db'))
    assert.isTrue(groups.has('redis'))
    assert.isTrue(groups.has('queue'))
    assert.isTrue(groups.has('app'))
    assert.isTrue(groups.has('log'))
    assert.equal(groups.size, 8)
  })
})

// ---------------------------------------------------------------------------
// detectFeatures — fetch failure returns DEFAULT_FEATURES
// ---------------------------------------------------------------------------

test.group('detectFeatures', (group) => {
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

  test('returns flattened config on successful response', async ({ assert }) => {
    const serverResponse: FeatureFlags = {
      features: {
        statsBar: true,
        debugPanel: true,
        dashboard: true,
        tracing: true,
        process: true,
        system: false,
        http: true,
        db: true,
        redis: false,
        queues: false,
        cache: true,
        app: false,
        log: true,
        emails: false,
      },
      customPanes: [],
      endpoints: { stats: '/api/stats', debug: '/api/debug', dashboard: '/api/dashboard' },
      transmit: { channelName: 'stats' },
    }

    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => serverResponse,
        text: async () => JSON.stringify(serverResponse),
      } as Response
    }) as typeof globalThis.fetch

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

  test('uses default options when none provided', async ({ assert }) => {
    let capturedUrl = ''

    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return {
        ok: true,
        status: 200,
        json: async () =>
          buildFlagsForFetch({
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
            },
          }),
        text: async () => '{}',
      } as Response
    }) as typeof globalThis.fetch

    const result = await detectFeatures({})

    // Default debugEndpoint is /admin/api/debug, path should end with /config
    assert.include(capturedUrl, '/admin/api/debug/config')
    assert.deepEqual(result.customPanes, [])
  })
})

/**
 * Helper to build a full FeatureFlags response for the fetch mock.
 */
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
      ...(overrides.features ?? {}),
    },
    customPanes: overrides.customPanes ?? [],
    endpoints: overrides.endpoints ?? { stats: '', debug: '', dashboard: '' },
    transmit: overrides.transmit ?? { channelName: '' },
  }
}
