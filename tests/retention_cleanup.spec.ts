import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from '@japa/runner'

import { defineConfig } from '../src/define_config.js'
import { createKnexConnection, applyPragmas } from '../src/dashboard/knex_factory.js'
import { autoMigrate, runRetentionCleanup } from '../src/dashboard/migrator.js'
import { resolveToolbarConfig } from '../src/provider/dashboard_setup.js'

import type { Knex } from 'knex'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertRequest(db: Knex, ageDays: number): Promise<number> {
  const rows = (await db.raw(
    `INSERT INTO server_stats_requests (method, url, status_code, duration, created_at)
     VALUES ('GET', '/x', 200, 1.0, datetime('now', '-${ageDays} days'))
     RETURNING id`
  )) as unknown as Array<{ id: number }>
  return rows[0].id
}

async function insertEvent(db: Knex, requestId: number, ageDays: number): Promise<void> {
  await db.raw(
    `INSERT INTO server_stats_events (request_id, event_name, created_at)
     VALUES (${requestId}, 'test:event', datetime('now', '-${ageDays} days'))`
  )
}

async function count(db: Knex, table: string): Promise<number> {
  const rows = (await db.raw(`SELECT COUNT(*) AS cnt FROM ${table}`)) as unknown as Array<{
    cnt: number
  }>
  return Number(rows[0].cnt)
}

// ---------------------------------------------------------------------------
// Test group
// ---------------------------------------------------------------------------

test.group('Dashboard | Retention cleanup', (group) => {
  let tmpDir: string
  let db: Knex

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-retention-test-'))
    db = await createKnexConnection(join(tmpDir, 'test.sqlite'))
    await applyPragmas(db)
    await autoMigrate(db)
  })

  group.each.teardown(async () => {
    await db.destroy()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('migrateEvents creates the request_id FK index', async ({ assert }) => {
    const rows = (await db.raw(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'server_stats_events'`
    )) as unknown as Array<{ name: string }>
    const names = rows.map((r) => r.name)
    assert.include(names, 'idx_ss_events_request')
  })

  test('new databases are created with incremental auto_vacuum', async ({ assert }) => {
    const rows = (await db.raw('PRAGMA auto_vacuum')) as unknown as Array<
      Record<string, unknown>
    >
    assert.equal(Number(Object.values(rows[0])[0]), 2)
  })

  test('cleanup deletes expired requests and cascades to events', async ({ assert }) => {
    const oldId = await insertRequest(db, 10)
    const freshId = await insertRequest(db, 1)
    await insertEvent(db, oldId, 10)
    await insertEvent(db, freshId, 1)

    await runRetentionCleanup(db, 7)

    assert.equal(await count(db, 'server_stats_requests'), 1)
    assert.equal(await count(db, 'server_stats_events'), 1)

    const remaining = (await db.raw(
      `SELECT request_id FROM server_stats_events`
    )) as unknown as Array<{ request_id: number }>
    assert.equal(remaining[0].request_id, freshId)
  })

  test('cleanup terminates when the backlog is an exact batch multiple', async ({ assert }) => {
    // batchDelete stops when a batch deletes fewer than 1000 rows; a backlog
    // of exactly 1000 must not loop forever (the follow-up batch deletes 0).
    await db.raw(
      `INSERT INTO server_stats_logs (level, message, created_at)
       SELECT 'info', 'old', datetime('now', '-10 days')
       FROM (WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1000)
             SELECT n FROM seq)`
    )
    assert.equal(await count(db, 'server_stats_logs'), 1000)

    await runRetentionCleanup(db, 7)

    assert.equal(await count(db, 'server_stats_logs'), 0)
  })

  test('cleanup handles a multi-batch backlog', async ({ assert }) => {
    await db.raw(
      `INSERT INTO server_stats_logs (level, message, created_at)
       SELECT 'info', 'old', datetime('now', '-10 days')
       FROM (WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2500)
             SELECT n FROM seq)`
    )
    await db.raw(
      `INSERT INTO server_stats_logs (level, message) VALUES ('info', 'fresh')`
    )

    await runRetentionCleanup(db, 7)

    assert.equal(await count(db, 'server_stats_logs'), 1)
  })

  test('cleanup leaves no freelist pages behind on incremental databases', async ({ assert }) => {
    // Write >8 MB so deleting it frees more than one incremental_vacuum
    // chunk (2000 pages) worth of pages, then verify the cleanup's vacuum
    // loop returned all of them to the OS.
    await db.raw(
      `INSERT INTO server_stats_logs (level, message, created_at)
       SELECT 'info', printf('%.*c', 2000, 'x'), datetime('now', '-10 days')
       FROM (WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 5000)
             SELECT n FROM seq)`
    )

    await runRetentionCleanup(db, 7)

    const rows = (await db.raw('PRAGMA freelist_count')) as unknown as Array<
      Record<string, unknown>
    >
    assert.equal(Number(Object.values(rows[0])[0]), 0)
  })
})

// ---------------------------------------------------------------------------
// Size cap
// ---------------------------------------------------------------------------

test.group('Dashboard | Database size cap', (group) => {
  let tmpDir: string
  let db: Knex

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-sizecap-test-'))
    db = await createKnexConnection(join(tmpDir, 'test.sqlite'))
    await applyPragmas(db)
    await autoMigrate(db)
  })

  group.each.teardown(async () => {
    await db.destroy()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  async function seedLogs(rows: number, ageDays: number, marker: string): Promise<void> {
    await db.raw(
      `INSERT INTO server_stats_logs (level, message, data, created_at)
       SELECT 'info', '${marker}', printf('%.*c', 2000, 'x'), datetime('now', '-${ageDays} days')
       FROM (WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${rows})
             SELECT n FROM seq)`
    )
  }

  async function countLogs(marker: string): Promise<number> {
    const rows = (await db.raw(
      `SELECT COUNT(*) AS cnt FROM server_stats_logs WHERE message = '${marker}'`
    )) as unknown as Array<{ cnt: number }>
    return Number(rows[0].cnt)
  }

  async function liveSizeBytes(): Promise<number> {
    const value = async (stmt: string) => {
      const rows = (await db.raw(stmt)) as unknown as Array<Record<string, unknown>>
      return Number(Object.values(rows[0])[0])
    }
    return ((await value('PRAGMA page_count')) - (await value('PRAGMA freelist_count'))) *
      (await value('PRAGMA page_size'))
  }

  test('prunes oldest rows first until under the cap', async ({ assert }) => {
    // ~6 MB of 2-day-old rows plus ~0.4 MB of fresh ones against a 3 MB cap.
    // Pruning works in 1000-row batches ordered by age, so the stop line can
    // overshoot by up to one batch — the fresh cohort is deliberately far
    // smaller than the target so it can never be reached. Nothing is past
    // the 7-day retention window, so only the size cap can delete anything.
    await seedLogs(3000, 2, 'old')
    await seedLogs(200, 0, 'new')

    await runRetentionCleanup(db, 7, 3)

    assert.equal(await countLogs('new'), 200)
    assert.isBelow(await countLogs('old'), 3000)
    assert.isBelow(await liveSizeBytes(), 3 * 1024 * 1024)
  })

  test('cap of 0 disables size enforcement', async ({ assert }) => {
    await seedLogs(1500, 2, 'old')

    await runRetentionCleanup(db, 7, 0)

    assert.equal(await countLogs('old'), 1500)
  })

  test('prunes the globally oldest table first', async ({ assert }) => {
    // Old bulky logs vs newer small requests: the cap must consume the logs
    // and leave the requests untouched.
    await seedLogs(1000, 3, 'old')
    await db.raw(
      `INSERT INTO server_stats_requests (method, url, status_code, duration, created_at)
       SELECT 'GET', '/x', 200, 1.0, datetime('now', '-1 days')
       FROM (WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 500)
             SELECT n FROM seq)`
    )

    await runRetentionCleanup(db, 7, 1)

    const requests = (await db.raw(
      `SELECT COUNT(*) AS cnt FROM server_stats_requests`
    )) as unknown as Array<{ cnt: number }>
    assert.equal(Number(requests[0].cnt), 500)
    assert.isBelow(await countLogs('old'), 1000)
  })

  test('under-cap databases are left alone', async ({ assert }) => {
    await seedLogs(100, 2, 'old')

    await runRetentionCleanup(db, 7, 500)

    assert.equal(await countLogs('old'), 100)
  })
})

// ---------------------------------------------------------------------------
// Config plumbing
// ---------------------------------------------------------------------------

test.group('Dashboard | maxDbSizeMb config resolution', () => {
  test('defaults to 500', ({ assert }) => {
    const resolved = resolveToolbarConfig({ enabled: true })
    assert.equal(resolved.maxDbSizeMb, 500)
  })

  test('explicit value wins over the default', ({ assert }) => {
    const resolved = resolveToolbarConfig({ enabled: true, maxDbSizeMb: 0 })
    assert.equal(resolved.maxDbSizeMb, 0)
  })

  test('production.maxDbSizeMb overrides in production', ({ assert }) => {
    const resolved = resolveToolbarConfig(
      { enabled: true, maxDbSizeMb: 200 },
      { inProduction: true, production: { enabled: true, maxDbSizeMb: 100 } }
    )
    assert.equal(resolved.maxDbSizeMb, 100)
  })

  test('dashboard alias maps maxDbSizeMb onto devToolbar options', ({ assert }) => {
    const config = defineConfig({ dashboard: { maxDbSizeMb: 250 } })
    assert.equal(config.devToolbar?.maxDbSizeMb, 250)
  })
})
