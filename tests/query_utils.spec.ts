import { test } from '@japa/runner'
import {
  filterQueries,
  countDuplicateQueries,
  computeQuerySummary,
} from '../src/core/query-utils.js'
import type { QueryRecord } from '../src/core/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuery(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    id: 1,
    sql: 'SELECT * FROM users',
    bindings: [],
    duration: 10,
    method: 'select',
    model: null,
    connection: 'postgres',
    inTransaction: false,
    timestamp: Date.now(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// filterQueries
// ---------------------------------------------------------------------------

test.group('filterQueries', () => {
  test('empty search returns all queries', ({ assert }) => {
    const queries = [makeQuery({ sql: 'SELECT 1' }), makeQuery({ sql: 'INSERT INTO foo' })]
    const result = filterQueries(queries, '')
    assert.lengthOf(result, 2)
    assert.deepEqual(result, queries)
  })

  test('matches against sql field (case-insensitive)', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT * FROM users' }),
      makeQuery({ sql: 'INSERT INTO orders' }),
    ]
    const result = filterQueries(queries, 'USERS')
    assert.lengthOf(result, 1)
    assert.equal(result[0].sql, 'SELECT * FROM users')
  })

  test('matches against model field (case-insensitive)', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT 1', model: 'User', method: 'raw' }),
      makeQuery({ sql: 'SELECT 2', model: 'Order', method: 'raw' }),
    ]
    const result = filterQueries(queries, 'user')
    assert.lengthOf(result, 1)
    assert.equal(result[0].model, 'User')
  })

  test('matches against method field (case-insensitive)', ({ assert }) => {
    const queries = [
      makeQuery({ method: 'select' }),
      makeQuery({ method: 'insert' }),
      makeQuery({ method: 'raw' }),
    ]
    const result = filterQueries(queries, 'INSERT')
    assert.lengthOf(result, 1)
    assert.equal(result[0].method, 'insert')
  })

  test('null model does not throw', ({ assert }) => {
    const queries = [makeQuery({ model: null, sql: 'SELECT 1' })]
    assert.doesNotThrow(() => filterQueries(queries, 'anything'))
    const result = filterQueries(queries, 'anything')
    assert.lengthOf(result, 0)
  })

  test('no matches returns empty array', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT 1', method: 'select', model: null }),
      makeQuery({ sql: 'INSERT INTO foo', method: 'insert', model: 'Foo' }),
    ]
    const result = filterQueries(queries, 'nonexistent')
    assert.lengthOf(result, 0)
  })

  test('empty input array returns empty array', ({ assert }) => {
    const result = filterQueries([], 'test')
    assert.deepEqual(result, [])
  })

  test('matches across multiple fields in the same query', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT * FROM users', model: 'User', method: 'select' }),
    ]
    // Should match via sql
    assert.lengthOf(filterQueries(queries, 'users'), 1)
    // Should match via model
    assert.lengthOf(filterQueries(queries, 'User'), 1)
    // Should match via method
    assert.lengthOf(filterQueries(queries, 'select'), 1)
  })
})

// ---------------------------------------------------------------------------
// countDuplicateQueries
// ---------------------------------------------------------------------------

test.group('countDuplicateQueries', () => {
  test('empty array returns empty record', ({ assert }) => {
    const result = countDuplicateQueries([])
    assert.deepEqual(result, {})
  })

  test('all unique queries have count 1', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT 1' }),
      makeQuery({ sql: 'SELECT 2' }),
      makeQuery({ sql: 'SELECT 3' }),
    ]
    const result = countDuplicateQueries(queries)
    assert.equal(result['SELECT 1'], 1)
    assert.equal(result['SELECT 2'], 1)
    assert.equal(result['SELECT 3'], 1)
  })

  test('duplicate queries are counted correctly', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT * FROM users' }),
      makeQuery({ sql: 'SELECT * FROM users' }),
      makeQuery({ sql: 'SELECT * FROM users' }),
      makeQuery({ sql: 'INSERT INTO orders' }),
      makeQuery({ sql: 'INSERT INTO orders' }),
    ]
    const result = countDuplicateQueries(queries)
    assert.equal(result['SELECT * FROM users'], 3)
    assert.equal(result['INSERT INTO orders'], 2)
  })

  test('single query returns count of 1', ({ assert }) => {
    const queries = [makeQuery({ sql: 'SELECT 1' })]
    const result = countDuplicateQueries(queries)
    assert.equal(result['SELECT 1'], 1)
  })
})

// ---------------------------------------------------------------------------
// computeQuerySummary
// ---------------------------------------------------------------------------

test.group('computeQuerySummary', () => {
  test('empty queries returns zero summary', ({ assert }) => {
    const result = computeQuerySummary([], {})
    assert.equal(result.slowCount, 0)
    assert.equal(result.dupCount, 0)
    assert.equal(result.avgDuration, 0)
    assert.equal(result.totalCount, 0)
  })

  test('counts slow queries (duration > 100ms)', ({ assert }) => {
    const queries = [
      makeQuery({ duration: 50 }),
      makeQuery({ duration: 101 }),
      makeQuery({ duration: 200 }),
      makeQuery({ duration: 99 }),
    ]
    const dupCounts = countDuplicateQueries(queries)
    const result = computeQuerySummary(queries, dupCounts)
    assert.equal(result.slowCount, 2)
  })

  test('query at exactly 100ms is not slow', ({ assert }) => {
    const queries = [makeQuery({ duration: 100 })]
    const dupCounts = countDuplicateQueries(queries)
    const result = computeQuerySummary(queries, dupCounts)
    assert.equal(result.slowCount, 0)
  })

  test('query at 100.01ms is slow', ({ assert }) => {
    const queries = [makeQuery({ duration: 100.01 })]
    const dupCounts = countDuplicateQueries(queries)
    const result = computeQuerySummary(queries, dupCounts)
    assert.equal(result.slowCount, 1)
  })

  test('counts duplicate SQL strings', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT * FROM users' }),
      makeQuery({ sql: 'SELECT * FROM users' }),
      makeQuery({ sql: 'SELECT * FROM orders' }),
      makeQuery({ sql: 'SELECT * FROM orders' }),
      makeQuery({ sql: 'SELECT 1' }),
    ]
    const dupCounts = countDuplicateQueries(queries)
    const result = computeQuerySummary(queries, dupCounts)
    // Two SQL strings appear more than once
    assert.equal(result.dupCount, 2)
  })

  test('no duplicates yields dupCount=0', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT 1' }),
      makeQuery({ sql: 'SELECT 2' }),
    ]
    const dupCounts = countDuplicateQueries(queries)
    const result = computeQuerySummary(queries, dupCounts)
    assert.equal(result.dupCount, 0)
  })

  test('computes average duration', ({ assert }) => {
    const queries = [
      makeQuery({ duration: 10 }),
      makeQuery({ duration: 20 }),
      makeQuery({ duration: 30 }),
    ]
    const dupCounts = countDuplicateQueries(queries)
    const result = computeQuerySummary(queries, dupCounts)
    assert.equal(result.avgDuration, 20)
  })

  test('average duration is 0 for empty queries', ({ assert }) => {
    const result = computeQuerySummary([], {})
    assert.equal(result.avgDuration, 0)
  })

  test('totalCount reflects number of queries', ({ assert }) => {
    const queries = [makeQuery(), makeQuery(), makeQuery()]
    const result = computeQuerySummary(queries, {})
    assert.equal(result.totalCount, 3)
  })

  test('full scenario with mixed slow, duplicate, and normal queries', ({ assert }) => {
    const queries = [
      makeQuery({ sql: 'SELECT * FROM users', duration: 50 }),
      makeQuery({ sql: 'SELECT * FROM users', duration: 150 }),
      makeQuery({ sql: 'INSERT INTO logs', duration: 5 }),
      makeQuery({ sql: 'UPDATE orders SET status=?', duration: 200 }),
    ]
    const dupCounts = countDuplicateQueries(queries)
    const result = computeQuerySummary(queries, dupCounts)

    assert.equal(result.totalCount, 4)
    assert.equal(result.slowCount, 2) // 150 and 200
    assert.equal(result.dupCount, 1) // "SELECT * FROM users" appears twice
    assert.equal(result.avgDuration, (50 + 150 + 5 + 200) / 4)
  })
})
