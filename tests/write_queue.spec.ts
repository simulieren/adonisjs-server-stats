import { test } from '@japa/runner'
import {
  normalizeSql,
  prepareRequestRows,
  prepareLogRows,
  buildEmailRow,
  buildEventRows,
} from '../src/dashboard/write_queue.js'

import type { PersistRequestInput } from '../src/dashboard/dashboard_store.js'
import type { EventRecord, EmailRecord } from '../src/debug/types.js'

// ---------------------------------------------------------------------------
// normalizeSql
// ---------------------------------------------------------------------------

test.group('normalizeSql', () => {
  test('replaces string literals with ?', ({ assert }) => {
    const result = normalizeSql("SELECT * FROM users WHERE name = 'John'")
    assert.equal(result, 'SELECT * FROM users WHERE name = ?')
  })

  test('replaces numeric literals with ?', ({ assert }) => {
    const result = normalizeSql('SELECT * FROM users WHERE id = 42')
    assert.equal(result, 'SELECT * FROM users WHERE id = ?')
  })

  test('replaces decimal numbers with ?', ({ assert }) => {
    const result = normalizeSql('SELECT * FROM products WHERE price > 19.99')
    assert.equal(result, 'SELECT * FROM products WHERE price > ?')
  })

  test('normalizes whitespace', ({ assert }) => {
    const result = normalizeSql('SELECT  *   FROM   users')
    assert.equal(result, 'SELECT * FROM users')
  })

  test('handles combined replacements', ({ assert }) => {
    const result = normalizeSql("INSERT INTO users (name, age) VALUES ('Alice', 30)")
    assert.equal(result, 'INSERT INTO users (name, age) VALUES (?, ?)')
  })

  test('trims the result', ({ assert }) => {
    const result = normalizeSql('  SELECT 1  ')
    assert.equal(result, 'SELECT ?')
  })
})

// ---------------------------------------------------------------------------
// prepareRequestRows
// ---------------------------------------------------------------------------

test.group('prepareRequestRows', () => {
  test('prepares basic request without queries or trace', ({ assert }) => {
    const input: PersistRequestInput = {
      method: 'GET',
      url: '/api/users',
      statusCode: 200,
      duration: 42.567,
      queries: [],
      trace: null,
    }

    const result = prepareRequestRows([input])
    assert.lengthOf(result, 1)
    assert.equal(result[0].input, input)
    assert.deepEqual(result[0].filteredQueries, [])
    assert.isNull(result[0].traceRow)
  })

  test('filters out server_stats connection queries', ({ assert }) => {
    const input: PersistRequestInput = {
      method: 'GET',
      url: '/api/users',
      statusCode: 200,
      duration: 50,
      queries: [
        {
          id: 1,
          sql: 'SELECT * FROM users',
          bindings: [],
          duration: 5,
          method: 'select',
          model: 'User',
          connection: 'postgres',
          inTransaction: false,
          timestamp: Date.now(),
        },
        {
          id: 2,
          sql: 'SELECT * FROM metrics',
          bindings: [],
          duration: 2,
          method: 'select',
          model: null,
          connection: 'server_stats',
          inTransaction: false,
          timestamp: Date.now(),
        },
      ],
      trace: null,
    }

    const result = prepareRequestRows([input])
    assert.lengthOf(result[0].filteredQueries, 1)
    assert.equal(result[0].filteredQueries[0].sql_text, 'SELECT * FROM users')
  })

  test('maps query fields correctly', ({ assert }) => {
    const input: PersistRequestInput = {
      method: 'POST',
      url: '/api/items',
      statusCode: 201,
      duration: 100,
      queries: [
        {
          id: 1,
          sql: 'INSERT INTO items (name) VALUES (?)',
          bindings: ['test'],
          duration: 3.456,
          method: 'insert',
          model: 'Item',
          connection: 'postgres',
          inTransaction: true,
          timestamp: Date.now(),
        },
      ],
      trace: null,
    }

    const result = prepareRequestRows([input])
    const q = result[0].filteredQueries[0]
    assert.equal(q.sql_text, 'INSERT INTO items (name) VALUES (?)')
    assert.equal(q.sql_normalized, 'INSERT INTO items (name) VALUES (?)')
    assert.equal(q.bindings, '["test"]')
    assert.equal(q.duration, 3.46) // rounded
    assert.equal(q.method, 'insert')
    assert.equal(q.model, 'Item')
    assert.equal(q.connection, 'postgres')
    assert.equal(q.in_transaction, 1)
  })

  test('prepares trace row when trace is present', ({ assert }) => {
    const input: PersistRequestInput = {
      method: 'GET',
      url: '/api/users',
      statusCode: 200,
      duration: 50,
      queries: [],
      trace: {
        id: 1,
        method: 'GET',
        url: '/api/users',
        statusCode: 200,
        totalDuration: 50.789,
        spanCount: 3,
        spans: [{ id: 's1', parentId: null, label: 'request', category: 'request', startOffset: 0, duration: 50 }],
        warnings: ['slow query'],
        timestamp: Date.now(),
      },
    }

    const result = prepareRequestRows([input])
    const tr = result[0].traceRow!
    assert.equal(tr.method, 'GET')
    assert.equal(tr.url, '/api/users')
    assert.equal(tr.status_code, 200)
    assert.equal(tr.total_duration, 50.79) // rounded
    assert.equal(tr.span_count, 3)
    assert.isString(tr.spans) // JSON stringified
    assert.isString(tr.warnings) // JSON stringified
  })

  test('trace row warnings is null when empty array', ({ assert }) => {
    const input: PersistRequestInput = {
      method: 'GET',
      url: '/api/users',
      statusCode: 200,
      duration: 50,
      queries: [],
      trace: {
        id: 1,
        method: 'GET',
        url: '/api/users',
        statusCode: 200,
        totalDuration: 50,
        spanCount: 0,
        spans: [],
        warnings: [],
        timestamp: Date.now(),
      },
    }

    const result = prepareRequestRows([input])
    assert.isNull(result[0].traceRow!.warnings)
  })

  test('handles null bindings', ({ assert }) => {
    const input: PersistRequestInput = {
      method: 'GET',
      url: '/raw',
      statusCode: 200,
      duration: 10,
      queries: [
        {
          id: 1,
          sql: 'SELECT 1',
          bindings: [],
          duration: 1,
          method: 'raw',
          model: null,
          connection: 'pg',
          inTransaction: false,
          timestamp: Date.now(),
        },
      ],
      trace: null,
    }

    // Empty bindings array should stringify
    const result = prepareRequestRows([input])
    assert.equal(result[0].filteredQueries[0].bindings, '[]')
  })
})

// ---------------------------------------------------------------------------
// prepareLogRows
// ---------------------------------------------------------------------------

test.group('prepareLogRows', () => {
  test('maps basic log entry', ({ assert }) => {
    const entry = { level: 30, levelName: 'info', msg: 'Hello world' }
    const result = prepareLogRows([entry])
    assert.lengthOf(result, 1)
    assert.equal(result[0].level, 'info')
    assert.equal(result[0].message, 'Hello world')
    assert.isNull(result[0].request_id)
    assert.isString(result[0].data) // JSON
  })

  test('extracts request_id from various fields', ({ assert }) => {
    const e1 = { level: 30, msg: 'test', request_id: 'req-1' }
    const e2 = { level: 30, msg: 'test', requestId: 'req-2' }
    const e3 = { level: 30, msg: 'test', 'x-request-id': 'req-3' }

    assert.equal(prepareLogRows([e1])[0].request_id, 'req-1')
    assert.equal(prepareLogRows([e2])[0].request_id, 'req-2')
    assert.equal(prepareLogRows([e3])[0].request_id, 'req-3')
  })

  test('uses message field when msg is absent', ({ assert }) => {
    const entry = { level: 30, message: 'alt message' }
    const result = prepareLogRows([entry])
    assert.equal(result[0].message, 'alt message')
  })

  test('falls back to level number when levelName is missing', ({ assert }) => {
    const entry = { level: 40, msg: 'test' }
    const result = prepareLogRows([entry])
    assert.equal(result[0].level, '40')
  })

  test('handles unknown level', ({ assert }) => {
    const entry = { msg: 'test' }
    const result = prepareLogRows([entry])
    assert.equal(result[0].level, 'unknown')
  })
})

// ---------------------------------------------------------------------------
// buildEmailRow
// ---------------------------------------------------------------------------

test.group('buildEmailRow', () => {
  test('builds email row from EmailRecord', ({ assert }) => {
    const record: EmailRecord = {
      id: 1,
      from: 'sender@test.com',
      to: 'receiver@test.com',
      cc: null,
      bcc: null,
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
      mailer: 'smtp',
      status: 'sent',
      messageId: 'msg-123',
      attachmentCount: 2,
      timestamp: Date.now(),
    }

    const row = buildEmailRow(record)
    assert.equal(row.from_addr, 'sender@test.com')
    assert.equal(row.to_addr, 'receiver@test.com')
    assert.isNull(row.cc)
    assert.isNull(row.bcc)
    assert.equal(row.subject, 'Test Subject')
    assert.equal(row.html, '<p>Hello</p>')
    assert.equal(row.text_body, 'Hello')
    assert.equal(row.mailer, 'smtp')
    assert.equal(row.status, 'sent')
    assert.equal(row.message_id, 'msg-123')
    assert.equal(row.attachment_count, 2)
  })
})

// ---------------------------------------------------------------------------
// buildEventRows
// ---------------------------------------------------------------------------

test.group('buildEventRows', () => {
  test('maps event records to rows', ({ assert }) => {
    const events: EventRecord[] = [
      { id: 1, event: 'user:registered', data: '{"id":1}', timestamp: Date.now() },
      { id: 2, event: 'order:placed', data: null, timestamp: Date.now() },
    ]

    const rows = buildEventRows(events)
    assert.lengthOf(rows, 2)
    assert.equal(rows[0].event_name, 'user:registered')
    assert.equal(rows[0].data, '{"id":1}')
    assert.isNull(rows[0].request_id)
    assert.equal(rows[1].event_name, 'order:placed')
    assert.isNull(rows[1].data)
  })
})
