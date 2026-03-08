import { test } from '@japa/runner'
import {
  matchesConfigSearch,
  shouldRedact,
} from '../src/core/config-utils.js'
import type { RedactedValue } from '../src/core/config-utils.js'

// ---------------------------------------------------------------------------
// matchesConfigSearch
// ---------------------------------------------------------------------------

test.group('matchesConfigSearch', () => {
  test('returns true when search term is empty', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('any.key', 'any value', ''))
  })

  test('matches key case-insensitively', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('App.Name', 'value', 'app'))
  })

  test('matches key by substring', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('database.host', 'localhost', 'host'))
  })

  test('matches string value case-insensitively', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('key', 'HelloWorld', 'helloworld'))
  })

  test('matches redacted value display string', ({ assert }) => {
    const redacted: RedactedValue = { __redacted: true, display: 'str***ng', value: 'secret' }
    assert.isTrue(matchesConfigSearch('key', redacted, 'str'))
  })

  test('does not throw for null value', ({ assert }) => {
    assert.isFalse(matchesConfigSearch('key', null, 'something'))
  })

  test('does not throw for undefined value', ({ assert }) => {
    assert.isFalse(matchesConfigSearch('key', undefined, 'something'))
  })

  test('returns false when neither key nor value matches', ({ assert }) => {
    assert.isFalse(matchesConfigSearch('app.name', 'myApp', 'database'))
  })

  test('matches number value when stringified', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('port', 3000, '3000'))
  })

  test('matches boolean value when stringified', ({ assert }) => {
    assert.isTrue(matchesConfigSearch('debug', true, 'true'))
  })
})

// ---------------------------------------------------------------------------
// shouldRedact
// ---------------------------------------------------------------------------

test.group('shouldRedact (common patterns)', () => {
  test('redacts "stripe.secretKey" (contains "secret" and "key")', ({ assert }) => {
    assert.isTrue(shouldRedact('stripe.secretKey'))
  })

  test('redacts "database.password"', ({ assert }) => {
    assert.isTrue(shouldRedact('database.password'))
  })

  test('redacts "auth.token"', ({ assert }) => {
    assert.isTrue(shouldRedact('auth.token'))
  })

  test('does not redact "app.name"', ({ assert }) => {
    assert.isFalse(shouldRedact('app.name'))
  })

  test('does not redact "keyboard.layout" (keyboard is one word)', ({ assert }) => {
    assert.isFalse(shouldRedact('keyboard.layout'))
  })

  test('redacts "API_KEY" (uppercase)', ({ assert }) => {
    assert.isTrue(shouldRedact('API_KEY'))
  })

  test('redacts paths containing "encryption"', ({ assert }) => {
    assert.isTrue(shouldRedact('app.encryption'))
  })

  test('redacts paths containing "pwd"', ({ assert }) => {
    assert.isTrue(shouldRedact('db.pwd'))
  })

  test('does not redact "monkey.patch" (monkey is one word)', ({ assert }) => {
    assert.isFalse(shouldRedact('monkey.patch'))
  })
})

test.group('shouldRedact (key variants)', () => {
  test('redacts "stripe.publishableKey" (contains "key")', ({ assert }) => {
    assert.isTrue(shouldRedact('stripe.publishableKey'))
  })

  test('redacts "app.key" (exact word "key")', ({ assert }) => {
    assert.isTrue(shouldRedact('app.key'))
  })

  test('redacts "api_key" (snake_case)', ({ assert }) => {
    assert.isTrue(shouldRedact('api_key'))
  })

  test('redacts "auth-token" (kebab-case)', ({ assert }) => {
    assert.isTrue(shouldRedact('auth-token'))
  })

  test('redacts "credential"', ({ assert }) => {
    assert.isTrue(shouldRedact('db.credential'))
  })

  test('redacts "credentials"', ({ assert }) => {
    assert.isTrue(shouldRedact('aws.credentials'))
  })

  test('redacts "private"', ({ assert }) => {
    assert.isTrue(shouldRedact('ssh.private'))
  })

  test('redacts "pass"', ({ assert }) => {
    assert.isTrue(shouldRedact('db.pass'))
  })

  test('does not redact "app.port"', ({ assert }) => {
    assert.isFalse(shouldRedact('app.port'))
  })

  test('does not redact "app.host"', ({ assert }) => {
    assert.isFalse(shouldRedact('app.host'))
  })
})
