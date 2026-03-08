import { test } from '@japa/runner'
import {
  buildQueryString,
  parsePaginatedResponse,
  createPaginationState,
  createFilterState,
  createSortState,
  buildQueryParams,
  DEFAULT_PER_PAGE,
} from '../src/core/pagination.js'

// ---------------------------------------------------------------------------
// buildQueryString
// ---------------------------------------------------------------------------

test.group('buildQueryString | basic', () => {
  test('pagination only', ({ assert }) => {
    const result = buildQueryString({ page: 2, perPage: 25 })
    const params = new URLSearchParams(result)
    assert.equal(params.get('page'), '2')
    assert.equal(params.get('perPage'), '25')
    assert.isNull(params.get('search'))
    assert.isNull(params.get('sort'))
  })

  test('with search filter', ({ assert }) => {
    const result = buildQueryString(
      { page: 1, perPage: 50 },
      { search: 'users', filters: {} }
    )
    const params = new URLSearchParams(result)
    assert.equal(params.get('search'), 'users')
  })

  test('with key-value filters', ({ assert }) => {
    const result = buildQueryString(
      { page: 1, perPage: 50 },
      { search: '', filters: { status: '500', method: 'GET' } }
    )
    const params = new URLSearchParams(result)
    assert.equal(params.get('status'), '500')
    assert.equal(params.get('method'), 'GET')
    assert.isNull(params.get('search'))
  })
})

test.group('buildQueryString | sort and combined', () => {
  test('with sort', ({ assert }) => {
    const result = buildQueryString(
      { page: 1, perPage: 10 },
      undefined,
      { field: 'duration', direction: 'asc' }
    )
    const params = new URLSearchParams(result)
    assert.equal(params.get('sort'), 'duration')
    assert.equal(params.get('direction'), 'asc')
  })

  test('combined pagination, filters, and sort', ({ assert }) => {
    const result = buildQueryString(
      { page: 3, perPage: 20 },
      { search: 'select', filters: { connection: 'postgres' } },
      { field: 'id', direction: 'desc' }
    )
    const params = new URLSearchParams(result)
    assert.equal(params.get('page'), '3')
    assert.equal(params.get('perPage'), '20')
    assert.equal(params.get('search'), 'select')
    assert.equal(params.get('connection'), 'postgres')
    assert.equal(params.get('sort'), 'id')
    assert.equal(params.get('direction'), 'desc')
  })

  test('falsy filter values are skipped', ({ assert }) => {
    const result = buildQueryString(
      { page: 1, perPage: 50 },
      { search: '', filters: { status: '', method: 'POST', level: '' } }
    )
    const params = new URLSearchParams(result)
    assert.isNull(params.get('status'))
    assert.equal(params.get('method'), 'POST')
    assert.isNull(params.get('level'))
  })
})

// ---------------------------------------------------------------------------
// parsePaginatedResponse
// ---------------------------------------------------------------------------

test.group('parsePaginatedResponse | parsing', () => {
  test('parses data array format', ({ assert }) => {
    const response = { data: [1, 2, 3], total: 100, page: 2, perPage: 10, totalPages: 10 }
    const result = parsePaginatedResponse<number>(response)
    assert.deepEqual(result.data, [1, 2, 3])
    assert.equal(result.pagination.page, 2)
    assert.equal(result.pagination.perPage, 10)
    assert.equal(result.pagination.total, 100)
    assert.equal(result.pagination.totalPages, 10)
  })

  test('parses items array format', ({ assert }) => {
    const response = { items: ['a', 'b'], total: 50, page: 1 }
    const result = parsePaginatedResponse<string>(response)
    assert.deepEqual(result.data, ['a', 'b'])
    assert.equal(result.pagination.total, 50)
  })

  test('missing data and items defaults to empty array', ({ assert }) => {
    const response = { total: 10, page: 1 }
    const result = parsePaginatedResponse(response)
    assert.deepEqual(result.data, [])
  })

  test('missing total defaults to 0', ({ assert }) => {
    const response = { data: [1] }
    const result = parsePaginatedResponse(response)
    assert.equal(result.pagination.total, 0)
  })

  test('missing page defaults to 1', ({ assert }) => {
    const response = { data: [1], total: 10 }
    const result = parsePaginatedResponse(response)
    assert.equal(result.pagination.page, 1)
  })
})

test.group('parsePaginatedResponse | defaults and computation', () => {
  test('limit is used as perPage fallback', ({ assert }) => {
    const response = { data: [1], total: 100, page: 1, limit: 25 }
    const result = parsePaginatedResponse(response)
    assert.equal(result.pagination.perPage, 25)
  })

  test('missing totalPages is computed from total and perPage', ({ assert }) => {
    const response = { data: [], total: 95, page: 1, perPage: 10 }
    const result = parsePaginatedResponse(response)
    assert.equal(result.pagination.totalPages, 10)
  })

  test('totalPages is 1 when total is 0', ({ assert }) => {
    const response = { data: [], total: 0, page: 1, perPage: 10 }
    const result = parsePaginatedResponse(response)
    assert.equal(result.pagination.totalPages, 1)
  })

  test('uses DEFAULT_PER_PAGE when no perPage or limit is given', ({ assert }) => {
    const response = { data: [], total: 200, page: 1 }
    const result = parsePaginatedResponse(response)
    assert.equal(result.pagination.perPage, DEFAULT_PER_PAGE)
    assert.equal(result.pagination.totalPages, Math.ceil(200 / DEFAULT_PER_PAGE))
  })

  test('uses custom perPage parameter when response has no perPage or limit', ({ assert }) => {
    const response = { data: [], total: 100, page: 1 }
    const result = parsePaginatedResponse(response, 20)
    assert.equal(result.pagination.perPage, 20)
    assert.equal(result.pagination.totalPages, 5)
  })
})

// ---------------------------------------------------------------------------
// createPaginationState
// ---------------------------------------------------------------------------

test.group('createPaginationState', () => {
  test('creates default pagination state', ({ assert }) => {
    const state = createPaginationState()
    assert.equal(state.page, 1)
    assert.equal(state.perPage, DEFAULT_PER_PAGE)
    assert.equal(state.total, 0)
    assert.equal(state.totalPages, 1)
  })

  test('creates pagination state with custom perPage', ({ assert }) => {
    const state = createPaginationState(25)
    assert.equal(state.perPage, 25)
    assert.equal(state.page, 1)
    assert.equal(state.total, 0)
    assert.equal(state.totalPages, 1)
  })
})

// ---------------------------------------------------------------------------
// createFilterState
// ---------------------------------------------------------------------------

test.group('createFilterState', () => {
  test('creates state with empty search and filters', ({ assert }) => {
    const state = createFilterState()
    assert.equal(state.search, '')
    assert.deepEqual(state.filters, {})
  })
})

// ---------------------------------------------------------------------------
// createSortState
// ---------------------------------------------------------------------------

test.group('createSortState', () => {
  test('creates default sort state with field=id and direction=desc', ({ assert }) => {
    const state = createSortState()
    assert.equal(state.field, 'id')
    assert.equal(state.direction, 'desc')
  })

  test('creates sort state with custom field', ({ assert }) => {
    const state = createSortState('duration')
    assert.equal(state.field, 'duration')
    assert.equal(state.direction, 'desc')
  })

  test('creates sort state with custom field and direction', ({ assert }) => {
    const state = createSortState('name', 'asc')
    assert.equal(state.field, 'name')
    assert.equal(state.direction, 'asc')
  })
})

// ---------------------------------------------------------------------------
// buildQueryParams
// ---------------------------------------------------------------------------

test.group('buildQueryParams | full and empty', () => {
  test('includes all fields when provided', ({ assert }) => {
    const result = buildQueryParams({
      page: 2,
      perPage: 25,
      search: 'test',
      sort: 'duration',
      sortDir: 'asc',
      timeRange: '1h',
      filters: { status: '200' },
    })
    const params = new URLSearchParams(result)
    assert.equal(params.get('page'), '2')
    assert.equal(params.get('perPage'), '25')
    assert.equal(params.get('search'), 'test')
    assert.equal(params.get('sort'), 'duration')
    assert.equal(params.get('direction'), 'asc')
    assert.equal(params.get('range'), '1h')
    assert.equal(params.get('status'), '200')
  })

  test('optional fields are omitted when not provided', ({ assert }) => {
    const result = buildQueryParams({})
    const params = new URLSearchParams(result)
    assert.isNull(params.get('page'))
    assert.isNull(params.get('perPage'))
    assert.isNull(params.get('search'))
    assert.isNull(params.get('sort'))
    assert.isNull(params.get('direction'))
    assert.isNull(params.get('range'))
  })

  test('filters with empty string values are skipped', ({ assert }) => {
    const result = buildQueryParams({
      filters: { status: '500', method: '', level: '' },
    })
    const params = new URLSearchParams(result)
    assert.equal(params.get('status'), '500')
    assert.isNull(params.get('method'))
    assert.isNull(params.get('level'))
  })
})

test.group('buildQueryParams | edge cases', () => {
  test('timeRange is mapped to "range" param', ({ assert }) => {
    const result = buildQueryParams({ timeRange: '24h' })
    const params = new URLSearchParams(result)
    assert.equal(params.get('range'), '24h')
    assert.isNull(params.get('timeRange'))
  })

  test('page=0 is included (not falsy-skipped)', ({ assert }) => {
    const result = buildQueryParams({ page: 0 })
    const params = new URLSearchParams(result)
    assert.equal(params.get('page'), '0')
  })

  test('perPage=0 is included (not falsy-skipped)', ({ assert }) => {
    const result = buildQueryParams({ perPage: 0 })
    const params = new URLSearchParams(result)
    assert.equal(params.get('perPage'), '0')
  })
})

