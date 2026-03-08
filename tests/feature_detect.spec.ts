import { test } from '@japa/runner'
import {
  DEFAULT_FEATURES,
  getVisibleMetricGroups,
} from '../src/core/feature-detect.js'

import type { FeatureConfig, FeatureFlags } from '../src/core/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// getVisibleMetricGroups — flat FeatureConfig (single flags)
// ---------------------------------------------------------------------------

test.group('getVisibleMetricGroups | flat FeatureConfig (single flags)', () => {
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
})

// ---------------------------------------------------------------------------
// getVisibleMetricGroups — flat FeatureConfig (combined)
// ---------------------------------------------------------------------------

test.group('getVisibleMetricGroups | flat FeatureConfig (combined)', () => {
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
