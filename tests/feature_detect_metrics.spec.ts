import { test } from '@japa/runner'
import { detectMetricGroupsFromStats } from '../src/core/feature-detect.js'

// ---------------------------------------------------------------------------
// detectMetricGroupsFromStats — process and memory
// ---------------------------------------------------------------------------

test.group('detectMetricGroupsFromStats | process & memory', () => {
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
})

// ---------------------------------------------------------------------------
// detectMetricGroupsFromStats — http and db
// ---------------------------------------------------------------------------

test.group('detectMetricGroupsFromStats | http & db', () => {
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
})

// ---------------------------------------------------------------------------
// detectMetricGroupsFromStats — redis, queues, app, log
// ---------------------------------------------------------------------------

test.group('detectMetricGroupsFromStats | redis & queues', () => {
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
})

test.group('detectMetricGroupsFromStats | app & log', () => {
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
})

// ---------------------------------------------------------------------------
// detectMetricGroupsFromStats — edge cases
// ---------------------------------------------------------------------------

test.group('detectMetricGroupsFromStats | edge cases', () => {
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
