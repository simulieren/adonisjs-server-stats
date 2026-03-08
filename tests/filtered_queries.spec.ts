import { test } from '@japa/runner'
import {
  applyRequestFilters,
  applyQueryFilters,
  applyEventFilters,
  applyEmailFilters,
  applyLogFilters,
  applyTraceFilters,
} from '../src/dashboard/filtered_queries.js'

import type {
  RequestFilters,
  QueryFilters,
  EventFilters,
  EmailFilters,
  LogFilters,
  TraceFilters,
} from '../src/dashboard/dashboard_store.js'

// ---------------------------------------------------------------------------
// Helpers — minimal Knex.QueryBuilder stub
// ---------------------------------------------------------------------------

interface WhereCall {
  method: string
  args: unknown[]
}

function createQueryStub() {
  const calls: WhereCall[] = []
  const qb: Record<string, Function> = {
    where(...args: unknown[]) {
      calls.push({ method: 'where', args })
      return qb
    },
    orWhere(...args: unknown[]) {
      calls.push({ method: 'orWhere', args })
      return qb
    },
    whereIn(...args: unknown[]) {
      calls.push({ method: 'whereIn', args })
      return qb
    },
    whereRaw(...args: unknown[]) {
      calls.push({ method: 'whereRaw', args })
      return qb
    },
    select(...args: unknown[]) {
      calls.push({ method: 'select', args })
      return qb
    },
  }
  return { qb, calls }
}

// ---------------------------------------------------------------------------
// applyRequestFilters
// ---------------------------------------------------------------------------

test.group('applyRequestFilters', () => {
  test('applies method filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: RequestFilters = { method: 'GET' }
    applyRequestFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.method === 'where' && c.args[0] === 'method' && c.args[1] === 'GET'))
  })

  test('applies url filter with LIKE', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: RequestFilters = { url: '/api/users' }
    applyRequestFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(
      calls.some((c) => c.method === 'where' && c.args[0] === 'url' && c.args[1] === 'like')
    )
  })

  test('applies status filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: RequestFilters = { status: 200 }
    applyRequestFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(
      calls.some((c) => c.method === 'where' && c.args[0] === 'status_code' && c.args[1] === 200)
    )
  })

  test('applies statusMin and statusMax filters', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: RequestFilters = { statusMin: 400, statusMax: 499 }
    applyRequestFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(
      calls.some((c) => c.method === 'where' && c.args[0] === 'status_code' && c.args[1] === '>=' && c.args[2] === 400)
    )
    assert.isTrue(
      calls.some((c) => c.method === 'where' && c.args[0] === 'status_code' && c.args[1] === '<=' && c.args[2] === 499)
    )
  })

  test('applies duration range filters', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: RequestFilters = { durationMin: 100, durationMax: 500 }
    applyRequestFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(
      calls.some((c) => c.method === 'where' && c.args[0] === 'duration' && c.args[1] === '>=' && c.args[2] === 100)
    )
    assert.isTrue(
      calls.some((c) => c.method === 'where' && c.args[0] === 'duration' && c.args[1] === '<=' && c.args[2] === 500)
    )
  })

  test('applies search filter with sub-query', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: RequestFilters = { search: 'users' }
    applyRequestFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    // The search should create a where with a callback
    assert.isTrue(calls.some((c) => c.method === 'where' && typeof c.args[0] === 'function'))
  })

  test('does nothing when filters are undefined', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    applyRequestFilters(qb as unknown as import('knex').Knex.QueryBuilder, undefined)
    assert.lengthOf(calls, 0)
  })
})

// ---------------------------------------------------------------------------
// applyQueryFilters
// ---------------------------------------------------------------------------

test.group('applyQueryFilters', () => {
  test('applies method filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: QueryFilters = { method: 'select' }
    applyQueryFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'method' && c.args[1] === 'select'))
  })

  test('applies model filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: QueryFilters = { model: 'User' }
    applyQueryFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'model' && c.args[1] === 'User'))
  })

  test('applies requestId filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: QueryFilters = { requestId: 42 }
    applyQueryFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'request_id' && c.args[1] === 42))
  })

  test('does nothing for undefined filters', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    applyQueryFilters(qb as unknown as import('knex').Knex.QueryBuilder, undefined)
    assert.lengthOf(calls, 0)
  })
})

// ---------------------------------------------------------------------------
// applyEventFilters
// ---------------------------------------------------------------------------

test.group('applyEventFilters', () => {
  test('applies eventName filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: EventFilters = { eventName: 'user:registered' }
    applyEventFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'event_name'))
  })

  test('applies search filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: EventFilters = { search: 'user' }
    applyEventFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'event_name'))
  })
})

// ---------------------------------------------------------------------------
// applyEmailFilters
// ---------------------------------------------------------------------------

test.group('applyEmailFilters', () => {
  test('applies search filter across from, to, subject', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: EmailFilters = { search: 'test' }
    applyEmailFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters, false)
    assert.isTrue(calls.some((c) => c.method === 'where' && typeof c.args[0] === 'function'))
  })

  test('applies from filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: EmailFilters = { from: 'noreply@test.com' }
    applyEmailFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters, false)
    assert.isTrue(calls.some((c) => c.args[0] === 'from_addr'))
  })

  test('applies mailer filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: EmailFilters = { mailer: 'smtp' }
    applyEmailFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters, false)
    assert.isTrue(calls.some((c) => c.args[0] === 'mailer' && c.args[1] === 'smtp'))
  })

  test('applies excludeBody select', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    applyEmailFilters(qb as unknown as import('knex').Knex.QueryBuilder, undefined, true)
    assert.isTrue(calls.some((c) => c.method === 'select'))
  })

  test('does not apply excludeBody select when false', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    applyEmailFilters(qb as unknown as import('knex').Knex.QueryBuilder, undefined, false)
    assert.isFalse(calls.some((c) => c.method === 'select'))
  })
})

// ---------------------------------------------------------------------------
// applyLogFilters
// ---------------------------------------------------------------------------

test.group('applyLogFilters', () => {
  test('applies level filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: LogFilters = { level: 'error' }
    applyLogFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'level' && c.args[1] === 'error'))
  })

  test('applies requestId filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: LogFilters = { requestId: 'req-123' }
    applyLogFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'request_id' && c.args[1] === 'req-123'))
  })

  test('applies search filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: LogFilters = { search: 'error' }
    applyLogFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'message'))
  })

  test('applies structured equals filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: LogFilters = {
      structured: [{ field: 'userId', operator: 'equals', value: '42' }],
    }
    applyLogFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(
      calls.some((c) => c.method === 'whereRaw' && (c.args[0] as string).includes('json_extract'))
    )
  })

  test('applies structured contains filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: LogFilters = {
      structured: [{ field: 'msg', operator: 'contains', value: 'err' }],
    }
    applyLogFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.method === 'whereRaw'))
  })

  test('applies structured startsWith filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: LogFilters = {
      structured: [{ field: 'path', operator: 'startsWith', value: '/api' }],
    }
    applyLogFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.method === 'whereRaw'))
  })
})

// ---------------------------------------------------------------------------
// applyTraceFilters
// ---------------------------------------------------------------------------

test.group('applyTraceFilters', () => {
  test('applies method filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: TraceFilters = { method: 'GET' }
    applyTraceFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'method' && c.args[1] === 'GET'))
  })

  test('applies url filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: TraceFilters = { url: '/api' }
    applyTraceFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.args[0] === 'url'))
  })

  test('applies statusMin and statusMax', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: TraceFilters = { statusMin: 500, statusMax: 599 }
    applyTraceFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(
      calls.some((c) => c.args[0] === 'status_code' && c.args[1] === '>=' && c.args[2] === 500)
    )
    assert.isTrue(
      calls.some((c) => c.args[0] === 'status_code' && c.args[1] === '<=' && c.args[2] === 599)
    )
  })

  test('applies search filter', ({ assert }) => {
    const { qb, calls } = createQueryStub()
    const filters: TraceFilters = { search: 'users' }
    applyTraceFilters(qb as unknown as import('knex').Knex.QueryBuilder, filters)
    assert.isTrue(calls.some((c) => c.method === 'where' && typeof c.args[0] === 'function'))
  })
})
