import { test } from '@japa/runner'

import { redactTokenLinks } from '../src/provider/email_helpers.js'

test.group('redactTokenLinks', () => {
  test('strips values of sensitive query params', ({ assert }) => {
    assert.equal(
      redactTokenLinks('https://app.example.com/pw?token=abc123'),
      'https://app.example.com/pw?token=[redacted]'
    )
  })

  test('catches prefixed and camelCase param names', ({ assert }) => {
    // `\b` cannot see `reset_token` (underscore is a word char) or
    // `resetToken` (no boundary at all) — the historical bypasses.
    assert.equal(
      redactTokenLinks('https://app.example.com/pw?reset_token=abc123'),
      'https://app.example.com/pw?reset_token=[redacted]'
    )
    assert.equal(
      redactTokenLinks('https://app.example.com/pw?resetToken=abc123'),
      'https://app.example.com/pw?resetToken=[redacted]'
    )
    assert.equal(
      redactTokenLinks('<a href="https://id.example.com/cb?id_token=xyz">'),
      '<a href="https://id.example.com/cb?id_token=[redacted]">'
    )
  })

  test('neutralizes credential-bearing paths including set-password', ({ assert }) => {
    assert.include(
      redactTokenLinks('Click https://app.example.com/reset/abc123 now'),
      'https://app.example.com/[redacted]'
    )
    assert.include(
      redactTokenLinks('Go to https://app.example.com/onboarding/set-password/abc123xyz'),
      '/[redacted]'
    )
  })

  test('redacts a long opaque path segment', ({ assert }) => {
    assert.equal(
      redactTokenLinks('https://app.example.com/l/aGVsbG8gd29ybGQgdGhpcyBpcyBzZWNyZXQ'),
      'https://app.example.com/l/[redacted]'
    )
  })

  test('leaves ordinary links and slugs alone', ({ assert }) => {
    const newsletter =
      'Read https://blog.example.com/posts/a-very-long-hyphenated-slug-for-a-post?utm_source=mail'
    assert.equal(redactTokenLinks(newsletter), newsletter)
  })
})
