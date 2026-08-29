import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from '@japa/runner'

import { createKnexConnection, applyPragmas } from '../src/dashboard/knex_factory.js'
import { autoMigrate, runRetentionCleanup } from '../src/dashboard/migrator.js'

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
