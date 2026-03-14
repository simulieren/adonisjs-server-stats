import { test } from '@japa/runner'
import { buildExplainSql, extractPlan, getAppDbClient } from '../src/dashboard/query_explain_handler.js'
import { QueryCollector } from '../src/debug/query_collector.js'

import type { DbDialect } from '../src/dashboard/query_explain_handler.js'
import type { Emitter } from '../src/debug/types.js'

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

class MockEmitter {
  private handlers = new Map<string, Function[]>()
  on(event: string, handler: Function) {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
  }
  off(event: string, handler: Function) {
    const list = this.handlers.get(event)
    if (list) {
      const idx = list.indexOf(handler)
      if (idx >= 0) list.splice(idx, 1)
    }
  }
  emit(event: string, data: unknown) {
    for (const h of this.handlers.get(event) || []) h(data)
  }
}

function makeQueryEvent(overrides: Record<string, unknown> = {}) {
  return {
    sql: 'SELECT * FROM users',
    bindings: [],
    duration: 1.5,
    method: 'select',
    model: null,
    connection: 'default',
    inTransaction: false,
    ...overrides,
  }
}

/**
 * Build a mock ApplicationService whose container resolves 'lucid.db'
 * to a fake Lucid instance with a given knex client config.
 */
function mockApp(clientName: string, driverName?: string) {
  return {
    container: {
      make: async (binding: string) => {
        if (binding !== 'lucid.db') throw new Error(`Unknown binding: ${binding}`)
        return {
          connection: () => ({
            getWriteClient: () => ({
              client: {
                config: { client: clientName },
                ...(driverName ? { driverName } : {}),
              },
              raw: async (sql: string, bindings: unknown[]) => ({ sql, bindings }),
            }),
          }),
        }
      },
    },
  } as any
}

function mockAppWithNamedConnection(connections: Record<string, string>) {
  return {
    container: {
      make: async (binding: string) => {
        if (binding !== 'lucid.db') throw new Error(`Unknown binding: ${binding}`)
        return {
          connection: (name?: string) => {
            const key = name || 'default'
            const clientName = connections[key]
            if (!clientName) throw new Error(`Unknown connection: ${key}`)
            return {
              getWriteClient: () => ({
                client: { config: { client: clientName } },
                raw: async (sql: string, bindings: unknown[]) => ({ sql, bindings }),
              }),
            }
          },
        }
      },
    },
  } as any
}

// ---------------------------------------------------------------------------
//  buildExplainSql
// ---------------------------------------------------------------------------

test.group('buildExplainSql', () => {
  const sql = 'SELECT * FROM users WHERE id = ?'

  test('PostgreSQL — uses EXPLAIN (FORMAT JSON)', ({ assert }) => {
    assert.equal(buildExplainSql(sql, 'pg'), `EXPLAIN (FORMAT JSON) ${sql}`)
  })

  test('MySQL — uses EXPLAIN FORMAT=JSON', ({ assert }) => {
    assert.equal(buildExplainSql(sql, 'mysql'), `EXPLAIN FORMAT=JSON ${sql}`)
  })

  test('SQLite — uses EXPLAIN QUERY PLAN', ({ assert }) => {
    assert.equal(buildExplainSql(sql, 'sqlite'), `EXPLAIN QUERY PLAN ${sql}`)
  })

  test('MSSQL — returns empty string (unsupported)', ({ assert }) => {
    assert.equal(buildExplainSql(sql, 'mssql'), '')
  })

  test('unknown dialect — falls back to plain EXPLAIN', ({ assert }) => {
    assert.equal(buildExplainSql(sql, 'unknown'), `EXPLAIN ${sql}`)
  })

  test('empty string result is falsy (used for unsupported check)', ({ assert }) => {
    const result = buildExplainSql(sql, 'mssql')
    assert.isFalse(!!result)
  })
})

// ---------------------------------------------------------------------------
//  extractPlan
// ---------------------------------------------------------------------------

test.group('extractPlan', () => {
  test('PostgreSQL — extracts QUERY PLAN from rows[0]', ({ assert }) => {
    const pgResult = {
      rows: [{ 'QUERY PLAN': [{ 'Node Type': 'Seq Scan', 'Relation Name': 'users' }] }],
    }
    const plan = extractPlan(pgResult, 'pg')
    assert.lengthOf(plan, 1)
    assert.equal((plan[0] as Record<string, unknown>)['Node Type'], 'Seq Scan')
  })

  test('PostgreSQL — returns raw rows when no QUERY PLAN key', ({ assert }) => {
    const pgResult = { rows: [{ id: 1, detail: 'something' }] }
    const plan = extractPlan(pgResult, 'pg')
    assert.lengthOf(plan, 1)
    assert.equal((plan[0] as Record<string, unknown>).id, 1)
  })

  test('SQLite — returns array directly', ({ assert }) => {
    const sqliteResult = [
      { id: 0, parent: 0, notused: 0, detail: 'SCAN users' },
      { id: 1, parent: 0, notused: 0, detail: 'SEARCH posts USING INDEX idx_user_id' },
    ]
    const plan = extractPlan(sqliteResult, 'sqlite')
    assert.lengthOf(plan, 2)
    assert.equal((plan[0] as Record<string, unknown>).detail, 'SCAN users')
  })

  test('SQLite — returns empty array for non-array input', ({ assert }) => {
    const plan = extractPlan({ rows: [] }, 'sqlite')
    assert.deepEqual(plan, [])
  })

  test('MySQL — extracts from rows property', ({ assert }) => {
    const mysqlResult = {
      rows: [{ id: 1, select_type: 'SIMPLE', table: 'users', type: 'ALL' }],
    }
    const plan = extractPlan(mysqlResult, 'mysql')
    assert.lengthOf(plan, 1)
    assert.equal((plan[0] as Record<string, unknown>).select_type, 'SIMPLE')
  })

  test('handles null/undefined input gracefully', ({ assert }) => {
    assert.deepEqual(extractPlan(null, 'pg'), [])
    assert.deepEqual(extractPlan(undefined, 'pg'), [])
  })

  test('handles empty rows', ({ assert }) => {
    assert.deepEqual(extractPlan({ rows: [] }, 'pg'), [])
  })

  test('defaults to pg dialect when none specified', ({ assert }) => {
    const pgResult = {
      rows: [{ 'QUERY PLAN': [{ 'Node Type': 'Index Scan' }] }],
    }
    const plan = extractPlan(pgResult)
    assert.lengthOf(plan, 1)
    assert.equal((plan[0] as Record<string, unknown>)['Node Type'], 'Index Scan')
  })

  test('falls back to array when result is array (no rows property)', ({ assert }) => {
    const arrayResult = [{ id: 1, detail: 'test' }]
    const plan = extractPlan(arrayResult, 'pg')
    // Array has no .rows, so fallback to Array.isArray(result) branch
    assert.lengthOf(plan, 1)
  })
})

// ---------------------------------------------------------------------------
//  getAppDbClient — dialect detection via mock app
// ---------------------------------------------------------------------------

test.group('getAppDbClient — dialect detection', () => {
  test('detects pg from client config', async ({ assert }) => {
    const app = mockApp('pg')
    const client = await getAppDbClient(app)
    assert.isNotNull(client)
    assert.equal(client!.dialect, 'pg')
  })

  test('detects postgres variant', async ({ assert }) => {
    const app = mockApp('postgres')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'pg')
  })

  test('detects better-sqlite3', async ({ assert }) => {
    const app = mockApp('better-sqlite3')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'sqlite')
  })

  test('detects sqlite3', async ({ assert }) => {
    const app = mockApp('sqlite3')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'sqlite')
  })

  test('detects libsql (Turso)', async ({ assert }) => {
    const app = mockApp('libsql')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'sqlite')
  })

  test('detects mysql', async ({ assert }) => {
    const app = mockApp('mysql')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'mysql')
  })

  test('detects mysql2', async ({ assert }) => {
    const app = mockApp('mysql2')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'mysql')
  })

  test('detects mssql', async ({ assert }) => {
    const app = mockApp('mssql')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'mssql')
  })

  test('detects tedious (MSSQL driver)', async ({ assert }) => {
    const app = mockApp('tedious')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'mssql')
  })

  test('returns unknown for unrecognized driver', async ({ assert }) => {
    const app = mockApp('cockroachdb')
    const client = await getAppDbClient(app)
    assert.equal(client!.dialect, 'unknown')
  })

  test('returns null when lucid.db is not available', async ({ assert }) => {
    const app = {
      container: {
        make: async () => {
          throw new Error('Binding not found')
        },
      },
    } as any
    const client = await getAppDbClient(app)
    assert.isNull(client)
  })

  test('raw function is callable', async ({ assert }) => {
    const app = mockApp('pg')
    const client = await getAppDbClient(app)
    assert.isNotNull(client)
    const result = (await client!.raw('SELECT 1', [])) as { sql: string }
    assert.equal(result.sql, 'SELECT 1')
  })

  test('respects named connection', async ({ assert }) => {
    const app = mockAppWithNamedConnection({
      default: 'pg',
      analytics: 'mysql',
    })
    const pgClient = await getAppDbClient(app)
    assert.equal(pgClient!.dialect, 'pg')

    const mysqlClient = await getAppDbClient(app, 'analytics')
    assert.equal(mysqlClient!.dialect, 'mysql')
  })
})

// ---------------------------------------------------------------------------
//  QueryCollector.getQueryById
// ---------------------------------------------------------------------------

test.group('QueryCollector.getQueryById', () => {
  test('returns query by id', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 1' }))
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 2' }))
    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 3' }))

    const q = collector.getQueryById(2)
    assert.isDefined(q)
    assert.equal(q!.sql, 'SELECT 2')
    assert.equal(q!.id, 2)

    collector.stop()
  })

  test('returns undefined for non-existent id', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('db:query', makeQueryEvent({ sql: 'SELECT 1' }))

    const q = collector.getQueryById(999)
    assert.isUndefined(q)

    collector.stop()
  })

  test('returns undefined from empty collector', async ({ assert }) => {
    const collector = new QueryCollector()
    const emitter = new MockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const q = collector.getQueryById(1)
    assert.isUndefined(q)

    collector.stop()
  })

  test('finds query after buffer wraps', async ({ assert }) => {
    const collector = new QueryCollector(5) // small buffer
    const emitter = new MockEmitter()
    await collector.start(emitter as unknown as Emitter)

    // Push 8 queries — buffer only holds 5, so ids 1-3 get overwritten
    for (let i = 0; i < 8; i++) {
      emitter.emit('db:query', makeQueryEvent({ sql: `SELECT ${i}` }))
    }

    // IDs 1-3 should be gone
    assert.isUndefined(collector.getQueryById(1))
    assert.isUndefined(collector.getQueryById(2))
    assert.isUndefined(collector.getQueryById(3))

    // IDs 4-8 should still exist
    assert.isDefined(collector.getQueryById(4))
    assert.isDefined(collector.getQueryById(8))
    assert.equal(collector.getQueryById(8)!.sql, 'SELECT 7')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
//  End-to-end: dialect → SQL → extract round-trip
// ---------------------------------------------------------------------------

test.group('EXPLAIN round-trip per dialect', () => {
  test('PostgreSQL round-trip', ({ assert }) => {
    const sql = 'SELECT * FROM users'
    const explainSql = buildExplainSql(sql, 'pg')
    assert.equal(explainSql, 'EXPLAIN (FORMAT JSON) SELECT * FROM users')

    const pgResult = {
      rows: [
        {
          'QUERY PLAN': [
            {
              Plan: {
                'Node Type': 'Seq Scan',
                'Relation Name': 'users',
                'Startup Cost': 0.0,
                'Total Cost': 10.5,
              },
            },
          ],
        },
      ],
    }
    const plan = extractPlan(pgResult, 'pg')
    assert.lengthOf(plan, 1)
    const top = plan[0] as Record<string, unknown>
    assert.property(top, 'Plan')
  })

  test('SQLite round-trip', ({ assert }) => {
    const sql = 'SELECT * FROM posts WHERE user_id = ?'
    const explainSql = buildExplainSql(sql, 'sqlite')
    assert.equal(explainSql, 'EXPLAIN QUERY PLAN SELECT * FROM posts WHERE user_id = ?')

    const sqliteResult = [
      { id: 2, parent: 0, notused: 0, detail: 'SEARCH posts USING INDEX idx_user_id (user_id=?)' },
    ]
    const plan = extractPlan(sqliteResult, 'sqlite')
    assert.lengthOf(plan, 1)
    assert.include((plan[0] as Record<string, unknown>).detail as string, 'SEARCH posts')
  })

  test('MySQL round-trip', ({ assert }) => {
    const sql = 'SELECT * FROM orders WHERE status = ?'
    const explainSql = buildExplainSql(sql, 'mysql')
    assert.equal(explainSql, 'EXPLAIN FORMAT=JSON SELECT * FROM orders WHERE status = ?')

    const mysqlResult = {
      rows: [
        {
          id: 1,
          select_type: 'SIMPLE',
          table: 'orders',
          type: 'ref',
          key: 'idx_status',
        },
      ],
    }
    const plan = extractPlan(mysqlResult, 'mysql')
    assert.lengthOf(plan, 1)
    assert.equal((plan[0] as Record<string, unknown>).key, 'idx_status')
  })

  test('MSSQL — unsupported, empty SQL string', ({ assert }) => {
    const sql = 'SELECT * FROM products'
    const explainSql = buildExplainSql(sql, 'mssql')
    assert.equal(explainSql, '')
    assert.isFalse(!!explainSql, 'empty string should be falsy for unsupported check')
  })
})
