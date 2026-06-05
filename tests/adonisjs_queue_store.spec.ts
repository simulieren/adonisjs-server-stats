import { test } from '@japa/runner'
import {
  mapJobRecordToSummary,
  buildQueueStoreReader,
} from '../src/dashboard/integrations/adonisjs_queue_store.js'

// ---------------------------------------------------------------------------
// Minimal local types matching the BoringJobRecord / BoringJobData shapes
// (copied from the module's internal interfaces for test construction)
// ---------------------------------------------------------------------------

interface TestJobData {
  id: string
  name: string
  payload?: unknown
  attempts: number
  createdAt?: number
  maxRetries?: number
  [key: string]: unknown
}

interface TestJobRecord {
  status: 'pending' | 'active' | 'delayed' | 'completed' | 'failed'
  data: TestJobData
  finishedAt?: number
  error?: string
}

// ---------------------------------------------------------------------------
// mapJobRecordToSummary — status mapping
// ---------------------------------------------------------------------------

test.group('mapJobRecordToSummary | status mapping', () => {
  function makeRecord(status: TestJobRecord['status']): TestJobRecord {
    return {
      status,
      data: { id: 'job-1', name: 'SendEmail', attempts: 0 },
    }
  }

  test('pending → waiting', ({ assert }) => {
    const summary = mapJobRecordToSummary(makeRecord('pending'), null)
    assert.equal(summary.status, 'waiting')
  })

  test('active → active', ({ assert }) => {
    const summary = mapJobRecordToSummary(makeRecord('active'), null)
    assert.equal(summary.status, 'active')
  })

  test('delayed → delayed', ({ assert }) => {
    const summary = mapJobRecordToSummary(makeRecord('delayed'), null)
    assert.equal(summary.status, 'delayed')
  })

  test('completed → completed', ({ assert }) => {
    const summary = mapJobRecordToSummary(makeRecord('completed'), null)
    assert.equal(summary.status, 'completed')
  })

  test('failed → failed', ({ assert }) => {
    const summary = mapJobRecordToSummary(makeRecord('failed'), null)
    assert.equal(summary.status, 'failed')
  })
})

// ---------------------------------------------------------------------------
// mapJobRecordToSummary — field mapping
// ---------------------------------------------------------------------------

test.group('mapJobRecordToSummary | field mapping', () => {
  test('maps id and name from data', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'abc-123', name: 'ProcessOrder', attempts: 2 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.id, 'abc-123')
    assert.equal(summary.name, 'ProcessOrder')
  })

  test('maps attempts from data.attempts', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'active',
      data: { id: 'j1', name: 'MyJob', attempts: 3 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.attempts, 3)
  })

  test('uses data.maxRetries for maxAttempts when present', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'failed',
      data: { id: 'j2', name: 'MyJob', attempts: 2, maxRetries: 5 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.maxAttempts, 5)
  })

  test('falls back to attempts for maxAttempts when maxRetries absent', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'j3', name: 'MyJob', attempts: 2 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.maxAttempts, 2)
  })

  test('progress is always 0 (not persisted by boringnode/queue)', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'active',
      data: { id: 'j4', name: 'MyJob', attempts: 1 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.progress, 0)
  })

  test('maps payload to both data and payload fields', ({ assert }) => {
    const payload = { userId: 42, action: 'send' }
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'j5', name: 'MyJob', attempts: 0, payload },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.deepEqual(summary.data, payload)
    assert.deepEqual(summary.payload, payload)
  })

  test('data and payload are null when payload is absent', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'j6', name: 'MyJob', attempts: 0 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.isNull(summary.data)
    assert.isNull(summary.payload)
  })

  test('failedReason maps from record.error', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'failed',
      data: { id: 'j7', name: 'MyJob', attempts: 1 },
      error: 'Connection timeout',
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.failedReason, 'Connection timeout')
  })

  test('failedReason is null when no error', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'completed',
      data: { id: 'j8', name: 'MyJob', attempts: 1 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.isNull(summary.failedReason)
  })

  test('createdAt and timestamp both use data.createdAt', ({ assert }) => {
    const ts = 1700000000000
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'j9', name: 'MyJob', attempts: 0, createdAt: ts },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.createdAt, ts)
    assert.equal(summary.timestamp, ts)
  })

  test('createdAt defaults to 0 when data.createdAt is absent', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'j10', name: 'MyJob', attempts: 0 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.createdAt, 0)
    assert.equal(summary.timestamp, 0)
  })
})

// ---------------------------------------------------------------------------
// mapJobRecordToSummary — timing fields
// ---------------------------------------------------------------------------

test.group('mapJobRecordToSummary | timing fields', () => {
  test('processedAt is null when acquiredAtMs is null', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'j11', name: 'J', attempts: 0 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.isNull(summary.processedAt)
  })

  test('processedAt uses acquiredAtMs when provided', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'active',
      data: { id: 'j12', name: 'J', attempts: 1 },
    }
    const summary = mapJobRecordToSummary(record, 1700000005000)
    assert.equal(summary.processedAt, 1700000005000)
  })

  test('finishedAt maps from record.finishedAt', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'completed',
      data: { id: 'j13', name: 'J', attempts: 1 },
      finishedAt: 1700000010000,
    }
    const summary = mapJobRecordToSummary(record, 1700000005000)
    assert.equal(summary.finishedAt, 1700000010000)
  })

  test('finishedAt is null when record.finishedAt is absent', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'active',
      data: { id: 'j14', name: 'J', attempts: 1 },
    }
    const summary = mapJobRecordToSummary(record, 1700000005000)
    assert.isNull(summary.finishedAt)
  })

  test('duration is computed as finishedAt - processedAt when both present', ({ assert }) => {
    const processedAt = 1700000005000
    const finishedAt = 1700000008000
    const record: TestJobRecord = {
      status: 'completed',
      data: { id: 'j15', name: 'J', attempts: 1 },
      finishedAt,
    }
    const summary = mapJobRecordToSummary(record, processedAt)
    assert.equal(summary.duration, finishedAt - processedAt)
  })

  test('duration is null when processedAt is null', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'completed',
      data: { id: 'j16', name: 'J', attempts: 1 },
      finishedAt: 1700000010000,
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.isNull(summary.duration)
  })

  test('duration is null when finishedAt is absent', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'active',
      data: { id: 'j17', name: 'J', attempts: 1 },
    }
    const summary = mapJobRecordToSummary(record, 1700000005000)
    assert.isNull(summary.duration)
  })
})

// ---------------------------------------------------------------------------
// mapJobRecordToSummary — job name cleaning
// ---------------------------------------------------------------------------

test.group('mapJobRecordToSummary | job name cleaning', () => {
  test('plain class name passes through unchanged', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'j18', name: 'SendEmailJob', attempts: 0 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.name, 'SendEmailJob')
  })

  test('file URL is stripped to PascalCase filename', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: {
        id: 'j19',
        name: 'file:///Users/simon/app/jobs/send_email_job.ts',
        attempts: 0,
      },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.name, 'SendEmailJob')
  })

  test('absolute path is stripped to PascalCase filename', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: {
        id: 'j20',
        name: '/app/jobs/process-order.js',
        attempts: 0,
      },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.name, 'ProcessOrder')
  })

  test('__default__ becomes "default"', ({ assert }) => {
    const record: TestJobRecord = {
      status: 'pending',
      data: { id: 'j21', name: '__default__', attempts: 0 },
    }
    const summary = mapJobRecordToSummary(record, null)
    assert.equal(summary.name, 'default')
  })
})

// ---------------------------------------------------------------------------
// buildQueueStoreReader — safe defaults / graceful degradation
// ---------------------------------------------------------------------------

test.group('buildQueueStoreReader | graceful degradation', () => {
  /**
   * A fake QueueManager whose adapter constructor name is controlled by the test.
   * Simulates the shape of QueueManagerSingleton.use().
   */
  function fakeQueueManager(adapterName: string) {
    return {
      use() {
        // Return an object whose constructor.name matches the given string
        return Object.create({ constructor: { name: adapterName } })
      },
    }
  }

  const minimalConfig = { default: 'database', adapters: {} }

  test('returns noop reader when driver is database but db is absent', async ({ assert }) => {
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager('KnexAdapter'),
      config: minimalConfig,
      db: undefined,
    })
    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
    const list = await reader.listJobs('all', 1, 25)
    assert.deepEqual(list, { jobs: [], total: 0 })
    const job = await reader.getJob('x')
    assert.isNull(job)
    const retried = await reader.retryJob('x')
    assert.isFalse(retried)
    const workers = await reader.getWorkerCount()
    assert.equal(workers, 0)
  })

  test('returns noop reader when driver is redis but redis is absent', async ({ assert }) => {
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager('RedisAdapter'),
      config: { default: 'redis', adapters: {} },
      redis: undefined,
    })
    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('returns noop reader when driver is unknown', async ({ assert }) => {
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager('SyncAdapter'),
      config: { default: 'sync', adapters: {} },
    })
    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('detects database driver from config default key regex when adapter name unknown', async ({
    assert,
  }) => {
    // adapter throws on use(), so fallback to config key regex
    const queueManager = {
      use() {
        throw new Error('not initialized')
      },
    }
    const reader = buildQueueStoreReader({
      queueManager,
      config: { default: 'database', adapters: {} },
      db: undefined,  // absent → noop
    })
    // Should reach database path (db absent → noop); getCounts returns zeros
    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('detects redis driver from config default key regex when adapter name unknown', async ({
    assert,
  }) => {
    const queueManager = {
      use() {
        throw new Error('not initialized')
      },
    }
    const reader = buildQueueStoreReader({
      queueManager,
      config: { default: 'redis', adapters: {} },
      redis: undefined,  // absent → noop
    })
    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })
})

// ---------------------------------------------------------------------------
// buildQueueStoreReader — DatabaseStoreReader with a fake knex client
// ---------------------------------------------------------------------------

test.group('buildQueueStoreReader | DatabaseStoreReader with fake knex', () => {
  /**
   * Build a fake Lucid db whose getWriteClient() returns a controlled knex stub.
   * We track which calls were made so we can assert on query shape.
   */
  function fakeLucidDb(knexStub: object) {
    return {
      primaryConnectionName: 'sqlite',
      connection(_name?: string) {
        return { getWriteClient: () => knexStub }
      },
    }
  }

  function fakeQueueManager() {
    return {
      use() {
        return { constructor: { name: 'KnexAdapter' } }
      },
    }
  }

  test('getCounts returns zeros when knex returns empty rows', async ({ assert }) => {
    // Chainable knex stub that resolves to an empty array
    const rows: unknown[] = []
    const chainable: Record<string, unknown> = {}
    const noop = () => chainable
    chainable.whereIn = noop
    chainable.select = noop
    chainable.count = noop
    chainable.groupBy = () => Promise.resolve(rows)
    const knexStub = (_table: string) => chainable

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('getCounts aggregates status rows correctly', async ({ assert }) => {
    const rows = [
      { status: 'pending',   count: '5' },
      { status: 'active',    count: '2' },
      { status: 'delayed',   count: '1' },
      { status: 'completed', count: '10' },
      { status: 'failed',    count: '3' },
    ]
    const chainable: Record<string, unknown> = {}
    const noop = () => chainable
    chainable.whereIn = noop
    chainable.select = noop
    chainable.count = noop
    chainable.groupBy = () => Promise.resolve(rows)
    const knexStub = (_table: string) => chainable

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const counts = await reader.getCounts()
    // pending → waiting
    assert.equal(counts.waiting, 5)
    assert.equal(counts.active, 2)
    assert.equal(counts.delayed, 1)
    assert.equal(counts.completed, 10)
    assert.equal(counts.failed, 3)
  })

  test('getCounts returns zeros on knex error', async ({ assert }) => {
    const knexStub = (_table: string) => {
      throw new Error('DB gone')
    }

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('listJobs returns empty result for paused status (no boringnode equivalent)', async ({
    assert,
  }) => {
    const knexStub = (_table: string) => ({})  // should not be called
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const result = await reader.listJobs('paused', 1, 25)
    assert.deepEqual(result, { jobs: [], total: 0 })
  })

  test('getJob returns null on knex error', async ({ assert }) => {
    const chainable: Record<string, unknown> = {}
    chainable.where = () => chainable
    chainable.first = () => { throw new Error('DB gone') }
    const knexStub = (_table: string) => chainable

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const job = await reader.getJob('some-id')
    assert.isNull(job)
  })

  test('retryJob returns false on knex error', async ({ assert }) => {
    const chainable: Record<string, unknown> = {}
    chainable.where = () => chainable
    chainable.andWhere = () => chainable
    chainable.update = () => { throw new Error('DB gone') }
    const knexStub = (_table: string) => chainable

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const retried = await reader.retryJob('some-id')
    assert.isFalse(retried)
  })

  test('retryJob returns true when one row updated', async ({ assert }) => {
    const chainable: Record<string, unknown> = {}
    chainable.where = () => chainable
    chainable.andWhere = () => chainable
    chainable.update = () => Promise.resolve(1)
    const knexStub = (_table: string) => chainable

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const retried = await reader.retryJob('some-id')
    assert.isTrue(retried)
  })

  test('retryJob returns false when no rows updated (job not failed)', async ({ assert }) => {
    const chainable: Record<string, unknown> = {}
    chainable.where = () => chainable
    chainable.andWhere = () => chainable
    chainable.update = () => Promise.resolve(0)
    const knexStub = (_table: string) => chainable

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const retried = await reader.retryJob('some-id')
    assert.isFalse(retried)
  })

  test('getJob maps DB row to QueueJobDetail correctly', async ({ assert }) => {
    const jobData = {
      id: 'job-99',
      name: 'SendEmail',
      payload: { to: 'alice@example.com' },
      attempts: 2,
      createdAt: 1700000000000,
    }
    const row = {
      id: 'job-99',
      queue: 'default',
      status: 'failed',
      data: JSON.stringify(jobData),
      acquired_at: 1700000005000,
      finished_at: 1700000010000,
      error: 'SMTP timeout',
    }

    const chainable: Record<string, unknown> = {}
    chainable.where = () => chainable
    chainable.first = () => Promise.resolve(row)
    const knexStub = (_table: string) => chainable

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'database', adapters: {} },
      db: fakeLucidDb(knexStub),
    })

    const detail = await reader.getJob('job-99')
    assert.isNotNull(detail)
    assert.equal(detail!.id, 'job-99')
    assert.equal(detail!.name, 'SendEmail')
    assert.equal(detail!.status, 'failed')
    assert.equal(detail!.attempts, 2)
    assert.equal(detail!.failedReason, 'SMTP timeout')
    assert.equal(detail!.processedAt, 1700000005000)
    assert.equal(detail!.finishedAt, 1700000010000)
    assert.equal(detail!.duration, 5000)
    assert.deepEqual(detail!.data, { to: 'alice@example.com' })
    assert.deepEqual(detail!.stackTrace, ['SMTP timeout'])
    assert.isNull(detail!.returnValue)
  })
})

// ---------------------------------------------------------------------------
// buildQueueStoreReader — RedisStoreReader with a fake redis connection
// ---------------------------------------------------------------------------

test.group('buildQueueStoreReader | RedisStoreReader with fake redis', () => {
  function fakeQueueManager() {
    return {
      use() {
        return { constructor: { name: 'RedisAdapter' } }
      },
    }
  }

  function fakeRedisManager(conn: object) {
    return {
      connection(_name?: string) {
        return conn
      },
    }
  }

  test('getCounts returns zeros when all keys are empty', async ({ assert }) => {
    const conn = {
      zcard: async () => 0,
      hlen: async () => 0,
    }
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'redis', adapters: {} },
      redis: fakeRedisManager(conn),
    })

    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('getCounts aggregates counts across default queue', async ({ assert }) => {
    const counts: Record<string, number> = {
      'jobs::default::pending':   3,
      'jobs::default::delayed':   1,
      'jobs::default::active':    2,
      'jobs::default::completed': 8,
      'jobs::default::failed':    4,
    }
    const conn = {
      zcard: async (key: string) => counts[key] ?? 0,
      hlen:  async (key: string) => counts[key] ?? 0,
    }
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'redis', adapters: {} },
      redis: fakeRedisManager(conn),
    })

    const result = await reader.getCounts()
    assert.equal(result.waiting, 3)
    assert.equal(result.delayed, 1)
    assert.equal(result.active, 2)
    assert.equal(result.completed, 8)
    assert.equal(result.failed, 4)
  })

  test('getCounts returns zeros on redis error', async ({ assert }) => {
    const conn = {
      zcard: async () => { throw new Error('Redis gone') },
      hlen:  async () => { throw new Error('Redis gone') },
    }
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'redis', adapters: {} },
      redis: fakeRedisManager(conn),
    })

    const counts = await reader.getCounts()
    assert.deepEqual(counts, { active: 0, waiting: 0, delayed: 0, completed: 0, failed: 0 })
  })

  test('listJobs returns empty result for paused status', async ({ assert }) => {
    const conn = {}
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'redis', adapters: {} },
      redis: fakeRedisManager(conn),
    })

    const result = await reader.listJobs('paused', 1, 25)
    assert.deepEqual(result, { jobs: [], total: 0 })
  })

  test('retryJob returns false when job not in failed hash', async ({ assert }) => {
    const conn = {
      hget: async () => null,
    }
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'redis', adapters: {} },
      redis: fakeRedisManager(conn),
    })

    const retried = await reader.retryJob('nonexistent')
    assert.isFalse(retried)
  })

  test('retryJob moves job from failed to pending and returns true', async ({ assert }) => {
    const jobData = { id: 'job-1', name: 'SendEmail', attempts: 1, createdAt: 1700000000000 }
    const record = { status: 'failed', data: jobData, error: 'oops' }
    const hgetCalls: string[] = []
    const hsetCalls: Array<[string, string, string]> = []
    const zaddCalls: Array<[string, number, string]> = []
    const hdelCalls: Array<[string, string]> = []

    const conn = {
      hget: async (key: string, field: string) => {
        hgetCalls.push(`${key}:${field}`)
        if (key === 'jobs::default::failed' && field === 'job-1') {
          return JSON.stringify(record)
        }
        return null
      },
      hset: async (key: string, field: string, value: string) => {
        hsetCalls.push([key, field, value])
        return 1
      },
      zadd: async (key: string, score: number, member: string) => {
        zaddCalls.push([key, score, member])
        return 1
      },
      hdel: async (key: string, field: string) => {
        hdelCalls.push([key, field])
        return 1
      },
      zrem: async () => 0,
    }

    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'redis', adapters: {} },
      redis: fakeRedisManager(conn),
    })

    const retried = await reader.retryJob('job-1')
    assert.isTrue(retried)
    // Verify the data was restored and job moved to pending
    assert.isTrue(hsetCalls.some(([k, f]) => k === 'jobs::default::data' && f === 'job-1'))
    assert.isTrue(zaddCalls.some(([k, , m]) => k === 'jobs::default::pending' && m === 'job-1'))
    assert.isTrue(hdelCalls.some(([k, f]) => k === 'jobs::default::failed' && f === 'job-1'))
  })

  test('getWorkerCount returns hlen of active hash across queues', async ({ assert }) => {
    const conn = {
      hlen: async (key: string) => (key === 'jobs::default::active' ? 3 : 0),
    }
    const reader = buildQueueStoreReader({
      queueManager: fakeQueueManager(),
      config: { default: 'redis', adapters: {} },
      redis: fakeRedisManager(conn),
    })

    const count = await reader.getWorkerCount()
    assert.equal(count, 3)
  })
})

// ---------------------------------------------------------------------------
// queue name resolution from config
// ---------------------------------------------------------------------------

test.group('buildQueueStoreReader | queue name resolution', () => {
  test('always includes "default" queue', async ({ assert }) => {
    // We verify indirectly: getCounts with a counting stub for each queue key call
    const queriedKeys = new Set<string>()
    const conn = {
      zcard: async (key: string) => { queriedKeys.add(key); return 0 },
      hlen:  async (key: string) => { queriedKeys.add(key); return 0 },
    }
    const reader = buildQueueStoreReader({
      queueManager: { use() { return { constructor: { name: 'RedisAdapter' } } } },
      config: { default: 'redis', adapters: {} },
      redis: { connection: () => conn as unknown as ReturnType<{ connection(): unknown }['connection']> },
    })
    await reader.getCounts()
    assert.isTrue([...queriedKeys].some((k) => k.includes('::default::')))
  })

  test('includes extra queues from config.queues', async ({ assert }) => {
    const queriedKeys = new Set<string>()
    const conn = {
      zcard: async (key: string) => { queriedKeys.add(key); return 0 },
      hlen:  async (key: string) => { queriedKeys.add(key); return 0 },
    }
    const reader = buildQueueStoreReader({
      queueManager: { use() { return { constructor: { name: 'RedisAdapter' } } } },
      config: { default: 'redis', adapters: {}, queues: { emails: {}, critical: {} } },
      redis: { connection: () => conn as unknown as ReturnType<{ connection(): unknown }['connection']> },
    })
    await reader.getCounts()
    assert.isTrue([...queriedKeys].some((k) => k.includes('::emails::')))
    assert.isTrue([...queriedKeys].some((k) => k.includes('::critical::')))
  })
})
