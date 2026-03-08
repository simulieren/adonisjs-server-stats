import { test } from '@japa/runner'
import {
  computePagination,
  getPageNumbers,
} from '../src/core/pagination.js'

// ---------------------------------------------------------------------------
// computePagination
// ---------------------------------------------------------------------------

test.group('computePagination (standard)', () => {
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
})

test.group('computePagination (edge cases)', () => {
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

test.group('getPageNumbers (small sets)', () => {
  test('returns [1] when lastPage is 1', ({ assert }) => {
    assert.deepEqual(getPageNumbers(1, 1), [1])
  })

  test('two pages returns [1, 2]', ({ assert }) => {
    assert.deepEqual(getPageNumbers(1, 2), [1, 2])
  })

  test('small page count with no ellipsis needed', ({ assert }) => {
    assert.deepEqual(getPageNumbers(3, 5), [1, 2, 3, 4, 5])
  })
})

test.group('getPageNumbers (large sets)', () => {
  test('current at start', ({ assert }) => {
    assert.deepEqual(getPageNumbers(1, 20), [1, 2, 3, '...', 20])
  })

  test('current in middle', ({ assert }) => {
    assert.deepEqual(getPageNumbers(10, 20), [1, '...', 8, 9, 10, 11, 12, '...', 20])
  })

  test('current at end', ({ assert }) => {
    assert.deepEqual(getPageNumbers(20, 20), [1, '...', 18, 19, 20])
  })

  test('custom window size', ({ assert }) => {
    assert.deepEqual(getPageNumbers(10, 20, 1), [1, '...', 9, 10, 11, '...', 20])
  })

  test('custom large window size', ({ assert }) => {
    assert.deepEqual(getPageNumbers(5, 10, 4), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test('page 2 does not show leading ellipsis', ({ assert }) => {
    assert.deepEqual(getPageNumbers(2, 20), [1, 2, 3, 4, '...', 20])
  })

  test('penultimate page does not show trailing ellipsis', ({ assert }) => {
    assert.deepEqual(getPageNumbers(19, 20), [1, '...', 17, 18, 19, 20])
  })
})
