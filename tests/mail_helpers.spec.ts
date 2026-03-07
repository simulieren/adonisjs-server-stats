import { test } from '@japa/runner'
import { extractAddresses } from '../src/utils/mail_helpers.js'

test.group('extractAddresses', () => {
  test('returns the string as-is for a plain string input', ({ assert }) => {
    assert.equal(extractAddresses('user@example.com'), 'user@example.com')
  })

  test('extracts address from an object with address property', ({ assert }) => {
    assert.equal(
      extractAddresses({ address: 'user@example.com', name: 'User' }),
      'user@example.com'
    )
  })

  test('extracts address from an object without name property', ({ assert }) => {
    assert.equal(extractAddresses({ address: 'user@example.com' }), 'user@example.com')
  })

  test('joins an array of strings into comma-separated addresses', ({ assert }) => {
    assert.equal(
      extractAddresses(['a@example.com', 'b@example.com']),
      'a@example.com, b@example.com'
    )
  })

  test('extracts addresses from an array of objects', ({ assert }) => {
    assert.equal(
      extractAddresses([
        { address: 'a@example.com', name: 'A' },
        { address: 'b@example.com', name: 'B' },
      ]),
      'a@example.com, b@example.com'
    )
  })

  test('handles a mixed array of strings and objects', ({ assert }) => {
    assert.equal(
      extractAddresses(['a@example.com', { address: 'b@example.com', name: 'B' }]),
      'a@example.com, b@example.com'
    )
  })

  test('returns empty string for null', ({ assert }) => {
    assert.equal(extractAddresses(null), '')
  })

  test('returns empty string for undefined', ({ assert }) => {
    assert.equal(extractAddresses(undefined), '')
  })

  test('returns empty string for empty string', ({ assert }) => {
    assert.equal(extractAddresses(''), '')
  })

  test('returns empty string for object without address property', ({ assert }) => {
    assert.equal(extractAddresses({ name: 'User' }), '')
    assert.equal(extractAddresses({}), '')
  })

  test('returns empty string for 0 (falsy non-string)', ({ assert }) => {
    assert.equal(extractAddresses(0), '')
  })

  test('returns empty string for false (falsy non-string)', ({ assert }) => {
    assert.equal(extractAddresses(false), '')
  })

  test('filters out empty entries from arrays', ({ assert }) => {
    assert.equal(
      extractAddresses(['a@example.com', { name: 'NoAddr' }, 'b@example.com']),
      'a@example.com, b@example.com'
    )
  })

  test('handles single-element array', ({ assert }) => {
    assert.equal(extractAddresses(['only@example.com']), 'only@example.com')
  })

  test('handles empty array', ({ assert }) => {
    assert.equal(extractAddresses([]), '')
  })
})
