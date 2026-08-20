import { test } from '@japa/runner'

import {
  isSecretName,
  isSensitiveConfigName,
  looksLikeCredentialValue,
  sanitizeRecordValues,
  sanitizeUrlQuery,
  sqlMentionsSecret,
} from '../src/dashboard/sensitive_patterns.js'
import { sanitizeBindings } from '../src/dashboard/write_queue.js'

const REDACTED = '[redacted]'

/**
 * Build a provider-key-shaped fixture from parts.
 *
 * Written as concatenation on purpose: a literal `sk_live_…` in the source is
 * enough to trip GitHub push protection even when the value is one of Stripe's
 * own documentation examples. Assembling at runtime keeps the pattern under test
 * while leaving no scannable token in the file.
 */
const fake = (prefix: string, body: string) => prefix + body

test.group('sensitive name patterns', () => {
  test('recognises credential-shaped names', ({ assert }) => {
    for (const name of [
      'password',
      'user_password',
      'PASSWORD',
      'remember_token',
      'api_key',
      'apiKey',
      'AWS_ACCESS_KEY_ID',
      'client_secret',
      'GOOGLE_CLIENT_SECRET',
      'webhook_secret',
      'encryption_key',
      'otp',
      'key',
      'DATABASE_DSN',
    ]) {
      assert.isTrue(isSecretName(name), `${name} should be secret`)
    }
  })

  test('recognises camelCase credential names', ({ assert }) => {
    // AdonisJS config keys and camelCase column strategies are the NORMAL
    // shape, not an edge case — these used to sail past the `_`-boundary
    // patterns while their snake_case twins were redacted.
    for (const name of [
      'userPassword',
      'passwordHash',
      'clientSecret',
      'jwtSecret',
      'sessionSecret',
      'apiSecret',
      'bearerToken',
      'stripeSecretKey',
      'rememberMeToken',
      'totpSecret',
      'mfaCode',
      'passwd',
      'pwd',
      'cvv',
      'cardPin',
      'ssn',
    ]) {
      assert.isTrue(isSecretName(name), `${name} should be secret`)
    }
  })

  test('plural credential names are still credentials', ({ assert }) => {
    for (const name of ['tokens', 'secrets', 'passwords', 'apiKeys']) {
      assert.isTrue(isSecretName(name), `${name} should be secret`)
    }
  })

  test('leaves ordinary names alone', ({ assert }) => {
    for (const name of [
      'id',
      'user_id',
      'created_at',
      'title',
      'author',
      'keyword',
      'monkey',
      'status',
      'authors',
      'createdAt',
      'userId',
      'authorName',
      'pinned',
      'spinner',
      'shipping',
      'statusCode',
    ]) {
      assert.isFalse(isSecretName(name), `${name} should not be secret`)
    }
  })

  test('email and smtp are config-only, not SQL-column concerns', ({ assert }) => {
    // An `email` env var is usually an SMTP account. An `email` column is
    // ordinary data, and redacting it would gut auth debugging.
    assert.isFalse(isSecretName('email'))
    assert.isFalse(isSecretName('SMTP_HOST'))
    assert.isTrue(isSensitiveConfigName('email'))
    assert.isTrue(isSensitiveConfigName('SMTP_HOST'))
    assert.isTrue(isSensitiveConfigName('DATABASE_URL'))
    assert.isTrue(isSensitiveConfigName('smtpHost'))
    assert.isTrue(isSensitiveConfigName('databaseUrl'))
  })
})

test.group('credential value shapes', () => {
  test('recognises credential-shaped values', ({ assert }) => {
    for (const value of [
      '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', // bcrypt
      '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$hash',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123', // JWT
      fake('sk' + '_', 'test_NOTAREALKEY000000000'), // Stripe-shaped
      fake('gh' + 'p_', 'NOTAREALTOKEN00000000000000000000'), // GitHub-shaped
      fake('xo' + 'xb-', '000000000000-NOTAREALTOKEN'), // Slack-shaped
      fake('AK' + 'IA', 'NOTAREALKEYID0000'), // AWS-shaped
      'a3f5c8d9e1b2478a6c0d4e9f1a2b3c4d', // 32 hex
      'postgres://user:hunter2@localhost:5432/db',
      'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5aHNz', // long base64url
    ]) {
      assert.isTrue(looksLikeCredentialValue(value), `${value.slice(0, 24)} should look secret`)
    }
  })

  test('leaves ordinary values alone', ({ assert }) => {
    for (const value of [
      '42',
      'active',
      'simon@example.com',
      'Hello world',
      '2026-08-19 10:00:00',
      'https://example.com/page',
      'deadbeef', // short hex
      'a-slug-for-a-post',
    ]) {
      assert.isFalse(looksLikeCredentialValue(value), `${value} should not look secret`)
    }
  })

  test('a bare email is not treated as a credential value', ({ assert }) => {
    // Config redacts emails; query bindings must not, or every auth query is
    // unreadable. See the config-only patterns above.
    assert.isFalse(looksLikeCredentialValue('user@example.com'))
  })
})

test.group('sqlMentionsSecret', () => {
  test('matches identifiers separated by spaces, commas, and parens', ({ assert }) => {
    assert.isTrue(sqlMentionsSecret('insert into users (email, password) values (?, ?)'))
    assert.isTrue(sqlMentionsSecret('select * from users where remember_token = ?'))
    assert.isTrue(sqlMentionsSecret('update users set otp = ? where id = ?'))
    assert.isTrue(sqlMentionsSecret('select "api_key" from apps where id = ?'))
  })

  test('matches camelCase identifiers', ({ assert }) => {
    assert.isTrue(sqlMentionsSecret('insert into "users" ("email", "passwordHash") values (?, ?)'))
    assert.isTrue(sqlMentionsSecret('update `users` set `userPassword` = ? where `id` = ?'))
    assert.isTrue(sqlMentionsSecret('update users set totpSecret = ? where id = ?'))
    assert.isTrue(sqlMentionsSecret('select rememberMeToken from users where id = ?'))
  })

  test('does not match ordinary statements', ({ assert }) => {
    assert.isFalse(sqlMentionsSecret('select * from users where email = ?'))
    assert.isFalse(sqlMentionsSecret('select id, title from posts where author = ?'))
    assert.isFalse(sqlMentionsSecret('delete from sessions where id = ?'))
  })
})

test.group('sanitizeBindings — by statement', () => {
  test('redacts every binding when the statement mentions a secret column', ({ assert }) => {
    const result = sanitizeBindings(
      ['simon@example.com', 'hunter2'],
      'insert into users (email, password) values (?, ?)'
    )

    assert.deepEqual(result, [REDACTED, REDACTED])
  })

  test('redacts a short secret that no shape rule would catch', ({ assert }) => {
    // A 6-digit OTP is the case length-truncation and shape-matching both miss.
    const result = sanitizeBindings(['123456'], 'update users set otp = ? where id = 1')

    assert.deepEqual(result, [REDACTED])
  })

  test('redacts non-string bindings on a secret statement', ({ assert }) => {
    const result = sanitizeBindings([123456, true, null], 'update users set otp = ? where id = ?')

    assert.deepEqual(result, [REDACTED, true, null])
  })

  test('leaves bindings intact for an ordinary statement', ({ assert }) => {
    const result = sanitizeBindings(
      ['simon@example.com', 42],
      'select * from users where email = ? and id = ?'
    )

    assert.deepEqual(result, ['simon@example.com', 42])
  })

  test('omitting the SQL text falls back to shape rules only', ({ assert }) => {
    assert.deepEqual(sanitizeBindings(['hunter2']), ['hunter2'])
  })
})

test.group('sanitizeBindings — by value shape', () => {
  test('redacts a credential-shaped value on an ordinary statement', ({ assert }) => {
    const result = sanitizeBindings(
      ['a3f5c8d9e1b2478a6c0d4e9f1a2b3c4d'],
      'select * from sessions where sid = ?'
    )

    assert.deepEqual(result, [REDACTED])
  })

  test('redacts a bcrypt hash wherever it appears', ({ assert }) => {
    const hash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

    assert.deepEqual(sanitizeBindings([hash], 'select 1'), [REDACTED])
  })

  test('still truncates oversized ordinary strings', ({ assert }) => {
    const long = 'a. '.repeat(200)
    const result = sanitizeBindings([long], 'insert into posts (body) values (?)') as string[]

    assert.include(result[0], 'truncated')
    assert.isBelow(result[0].length, long.length)
  })

  test('a value just under the cap passes through', ({ assert }) => {
    const value = 'x. '.repeat(50).slice(0, 100)

    assert.deepEqual(sanitizeBindings([value], 'insert into posts (body) values (?)'), [value])
  })
})

test.group('sanitizeBindings — structure', () => {
  test('named bindings use their own key', ({ assert }) => {
    const result = sanitizeBindings({ email: 'simon@example.com', password: 'hunter2' }, 'select 1')

    assert.deepEqual(result, { email: 'simon@example.com', password: REDACTED })
  })

  test('recurses into nested structures', ({ assert }) => {
    const result = sanitizeBindings({ filters: { token: 'abc', status: 'active' } }, 'select 1')

    assert.deepEqual(result, { filters: { token: REDACTED, status: 'active' } })
  })

  test('a secret statement redacts nested values too', ({ assert }) => {
    const result = sanitizeBindings(
      { data: { a: 'one', b: 'two' } },
      'update users set password = ?'
    )

    assert.deepEqual(result, { data: { a: REDACTED, b: REDACTED } })
  })
})

test.group('sanitizeUrlQuery', () => {
  test('redacts credential-bearing query params by name', ({ assert }) => {
    assert.equal(
      sanitizeUrlQuery('/reset-password?token=abc123&next=%2Fhome'),
      '/reset-password?token=[redacted]&next=%2Fhome'
    )
    assert.equal(sanitizeUrlQuery('/verify?otp=123456'), '/verify?otp=[redacted]')
    assert.equal(sanitizeUrlQuery('/cb?resetToken=xyz&page=2'), '/cb?resetToken=[redacted]&page=2')
  })

  test('redacts credential-shaped values under innocent names', ({ assert }) => {
    assert.equal(
      sanitizeUrlQuery('/files?sig=a3f5c8d9e1b2478a6c0d4e9f1a2b3c4d'),
      '/files?sig=[redacted]'
    )
  })

  test('leaves ordinary URLs untouched', ({ assert }) => {
    assert.equal(sanitizeUrlQuery('/users?page=2&sort=name'), '/users?page=2&sort=name')
    assert.equal(sanitizeUrlQuery('/users/42'), '/users/42')
    assert.equal(sanitizeUrlQuery('/search?q=hello+world'), '/search?q=hello+world')
  })
})

test.group('sanitizeRecordValues (log entries)', () => {
  test('redacts secret-named keys without truncating long values', ({ assert }) => {
    const stack = 'Error: boom\n    at handler '.padEnd(600, 'x')
    const entry = {
      msg: 'request failed',
      req: { headers: { authorization: 'Bearer eyJx', cookie: 'sid=abc' } },
      err: { stack },
      password: 'hunter2',
    }

    const out = sanitizeRecordValues(entry) as Record<string, any>

    assert.equal(out.password, '[redacted]')
    assert.equal(out.req.headers.authorization, '[redacted]')
    assert.equal(out.req.headers.cookie, '[redacted]')
    assert.equal(out.msg, 'request failed')
    assert.equal(out.err.stack, stack)
  })
})
