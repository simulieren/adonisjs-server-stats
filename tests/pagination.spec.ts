import { test } from '@japa/runner'
import {
  buildQueryString,
  parsePaginatedResponse,
  createPaginationState,
  createFilterState,
  createSortState,
  buildQueryParams,
  computePagination,
  getPageNumbers,
  DEFAULT_PER_PAGE,
} from '../src/core/pagination.js'

// ---------------------------------------------------------------------------
// buildQueryString
// ---------------------------------------------------------------------------

test.group('buildQueryString', () => {
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

test.group('parsePaginatedResponse', () => {
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

test.group('buildQueryParams', () => {
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

// ---------------------------------------------------------------------------
// computePagination
// ---------------------------------------------------------------------------

test.group('computePagination', () => {
  test('standard case in the middle', ({ assert }) => {
    const result = computePagination({ page: 2, perPage: 10, total: 50 })
    assert.equal(result.page, 2)
    assert.equal(result.perPage, 10)
    assert.equal(result.total, 50)
    assert.equal(result.lastPage, 5)
    assert.equal(result.from, 11)
    assert.equal(result.to, 20)
    assert.isTrue(result.hasPrev)
    assert.isTrue(result.hasNext)
  })

  test('first page has hasPrev=false', ({ assert }) => {
    const result = computePagination({ page: 1, perPage: 10, total: 50 })
    assert.isFalse(result.hasPrev)
    assert.isTrue(result.hasNext)
    assert.equal(result.from, 1)
    assert.equal(result.to, 10)
  })

  test('last page has hasNext=false', ({ assert }) => {
    const result = computePagination({ page: 5, perPage: 10, total: 50 })
    assert.isTrue(result.hasPrev)
    assert.isFalse(result.hasNext)
    assert.equal(result.from, 41)
    assert.equal(result.to, 50)
  })

  test('single page has both hasPrev=false and hasNext=false', ({ assert }) => {
    const result = computePagination({ page: 1, perPage: 10, total: 5 })
    assert.isFalse(result.hasPrev)
    assert.isFalse(result.hasNext)
    assert.equal(result.lastPage, 1)
    assert.equal(result.from, 1)
    assert.equal(result.to, 5)
  })

  test('total=0 gives from=0 and to=0', ({ assert }) => {
    const result = computePagination({ page: 1, perPage: 10, total: 0 })
    assert.equal(result.from, 0)
    assert.equal(result.to, 0)
    assert.equal(result.lastPage, 1)
    assert.isFalse(result.hasPrev)
    assert.isFalse(result.hasNext)
  })

  test('partial last page computes correct to value', ({ assert }) => {
    const result = computePagination({ page: 3, perPage: 10, total: 25 })
    assert.equal(result.lastPage, 3)
    assert.equal(result.from, 21)
    assert.equal(result.to, 25)
    assert.isFalse(result.hasNext)
  })

  test('page exceeding lastPage is clamped', ({ assert }) => {
    const result = computePagination({ page: 100, perPage: 10, total: 30 })
    assert.equal(result.page, 3)
    assert.equal(result.lastPage, 3)
    assert.isFalse(result.hasNext)
  })
})

// ---------------------------------------------------------------------------
// getPageNumbers
// ---------------------------------------------------------------------------

test.group('getPageNumbers', () => {
  test('returns [1] when lastPage is 1', ({ assert }) => {
    const result = getPageNumbers(1, 1)
    assert.deepEqual(result, [1])
  })

  test('small page count with no ellipsis needed', ({ assert }) => {
    // window=2, currentPage=3, lastPage=5
    // rangeStart = max(2, 3-2) = 2, rangeEnd = min(4, 3+2) = 4
    // pages: 1, 2, 3, 4, 5 (no gaps)
    const result = getPageNumbers(3, 5)
    assert.deepEqual(result, [1, 2, 3, 4, 5])
  })

  test('large count with current at start', ({ assert }) => {
    const result = getPageNumbers(1, 20)
    // page 1, then window around 1 (pages 2, 3), ellipsis, then 20
    assert.deepEqual(result, [1, 2, 3, '...', 20])
  })

  test('large count with current in middle', ({ assert }) => {
    const result = getPageNumbers(10, 20)
    // 1, ..., 8, 9, 10, 11, 12, ..., 20
    assert.deepEqual(result, [1, '...', 8, 9, 10, 11, 12, '...', 20])
  })

  test('large count with current at end', ({ assert }) => {
    const result = getPageNumbers(20, 20)
    // 1, ..., 18, 19, 20
    assert.deepEqual(result, [1, '...', 18, 19, 20])
  })

  test('custom window size', ({ assert }) => {
    const result = getPageNumbers(10, 20, 1)
    // window=1: 1, ..., 9, 10, 11, ..., 20
    assert.deepEqual(result, [1, '...', 9, 10, 11, '...', 20])
  })

  test('custom large window size', ({ assert }) => {
    const result = getPageNumbers(5, 10, 4)
    // window=4 around page 5: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    assert.deepEqual(result, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test('current at page 2 of large set does not show leading ellipsis', ({ assert }) => {
    const result = getPageNumbers(2, 20)
    // rangeStart = max(2, 2-2) = 2; no gap between 1 and 2 so no leading ellipsis
    // 1, 2, 3, 4, ..., 20
    assert.deepEqual(result, [1, 2, 3, 4, '...', 20])
  })

  test('current at penultimate page does not show trailing ellipsis', ({ assert }) => {
    const result = getPageNumbers(19, 20)
    // rangeEnd = min(19, 19+2) = 19; 19 === lastPage-1 so no trailing ellipsis
    // 1, ..., 17, 18, 19, 20
    assert.deepEqual(result, [1, '...', 17, 18, 19, 20])
  })

  test('two pages returns [1, 2]', ({ assert }) => {
    const result = getPageNumbers(1, 2)
    assert.deepEqual(result, [1, 2])
  })
})
