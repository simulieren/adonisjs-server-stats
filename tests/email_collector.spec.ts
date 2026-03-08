import { test } from '@japa/runner'
import type { Emitter } from '../src/debug/types.js'
import { EmailCollector } from '../src/debug/email_collector.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEmitter() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    on(event: string, handler: Function) {
      ;(handlers[event] ??= []).push(handler)
    },
    off(event: string, handler: Function) {
      const arr = handlers[event]
      if (arr) {
        const i = arr.indexOf(handler)
        if (i >= 0) arr.splice(i, 1)
      }
    },
    emit(event: string, data: unknown) {
      handlers[event]?.forEach((h) => h(data))
    },
    handlers,
  }
}

function makeSendingData(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Hello World',
      html: '<p>Hello</p>',
      text: 'Hello',
      ...overrides,
    },
    mailerName: 'smtp',
  }
}

function makeSentData(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Hello World',
      html: '<p>Hello</p>',
      text: 'Hello',
    },
    mailerName: 'smtp',
    response: { messageId: 'msg-001' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests -- Constructor
// ---------------------------------------------------------------------------

test.group('EmailCollector | Constructor', () => {
  test('defaults to capacity 100', ({ assert }) => {
    const collector = new EmailCollector()
    const info = collector.getBufferInfo()
    assert.equal(info.max, 100)
    assert.equal(info.current, 0)
  })

  test('accepts a custom capacity', ({ assert }) => {
    const collector = new EmailCollector(50)
    const info = collector.getBufferInfo()
    assert.equal(info.max, 50)
  })
})

// ---------------------------------------------------------------------------
// Tests -- start(emitter) registers handlers
// ---------------------------------------------------------------------------

test.group('EmailCollector | start(emitter)', () => {
  test('registers handlers for all five mail events', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    assert.isTrue('mail:sending' in emitter.handlers)
    assert.isTrue('mail:sent' in emitter.handlers)
    assert.isTrue('mail:queueing' in emitter.handlers)
    assert.isTrue('mail:queued' in emitter.handlers)
    assert.isTrue('queued:mail:error' in emitter.handlers)

    assert.lengthOf(emitter.handlers['mail:sending'], 1)
    assert.lengthOf(emitter.handlers['mail:sent'], 1)
    assert.lengthOf(emitter.handlers['mail:queueing'], 1)
    assert.lengthOf(emitter.handlers['mail:queued'], 1)
    assert.lengthOf(emitter.handlers['queued:mail:error'], 1)

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- mail:sending event
// ---------------------------------------------------------------------------

test.group('EmailCollector | mail:sending', () => {
  test('creates a record with status "sending" and extracts fields', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData())

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1)

    const email = emails[0]
    assert.equal(email.status, 'sending')
    assert.equal(email.from, 'sender@example.com')
    assert.equal(email.to, 'recipient@example.com')
    assert.equal(email.subject, 'Hello World')
    assert.equal(email.html, '<p>Hello</p>')
    assert.equal(email.text, 'Hello')
    assert.equal(email.mailer, 'smtp')
    assert.isNull(email.messageId)
    assert.isNumber(email.timestamp)
    assert.isNumber(email.id)

    collector.stop()
  })

  test('extracts array "to" addresses as comma-separated string', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit(
      'mail:sending',
      makeSendingData({
        to: [{ address: 'a@test.com' }, { address: 'b@test.com' }],
      })
    )

    const emails = collector.getEmails()
    assert.equal(emails[0].to, 'a@test.com, b@test.com')

    collector.stop()
  })

  test('extracts cc and bcc addresses', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit(
      'mail:sending',
      makeSendingData({
        cc: 'cc@test.com',
        bcc: 'bcc@test.com',
      })
    )

    const emails = collector.getEmails()
    assert.equal(emails[0].cc, 'cc@test.com')
    assert.equal(emails[0].bcc, 'bcc@test.com')

    collector.stop()
  })

  test('defaults subject to "(no subject)" when missing', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit(
      'mail:sending',
      makeSendingData({ subject: undefined })
    )

    assert.equal(collector.getEmails()[0].subject, '(no subject)')

    collector.stop()
  })

  test('defaults from to "unknown" when missing', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit(
      'mail:sending',
      makeSendingData({ from: undefined })
    )

    assert.equal(collector.getEmails()[0].from, 'unknown')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- mail:sent updates matching sending record
// ---------------------------------------------------------------------------

test.group('EmailCollector | mail:sent updates matching sending', () => {
  test('finds matching sending record by to+subject and updates to "sent"', async ({
    assert,
  }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData())
    emitter.emit('mail:sent', makeSentData())

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1, 'should not create a second record')
    assert.equal(emails[0].status, 'sent')
    assert.equal(emails[0].messageId, 'msg-001')

    collector.stop()
  })

  test('updates the most recent matching sending record (findFromEnd)', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    // Two sending events with the same to+subject
    emitter.emit('mail:sending', makeSendingData())
    emitter.emit('mail:sending', makeSendingData())

    // Sent should update the second (most recent) one
    emitter.emit('mail:sent', makeSentData())

    const emails = collector.getEmails()
    assert.lengthOf(emails, 2)
    assert.equal(emails[0].status, 'sent', 'second (most recent) record should be updated to sent')
    assert.equal(emails[1].status, 'sending', 'first record should stay as sending')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- mail:sent with no matching sending
// ---------------------------------------------------------------------------

test.group('EmailCollector | mail:sent with no matching sending', () => {
  test('creates a fresh "sent" record when no matching sending exists', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sent', makeSentData())

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1)
    assert.equal(emails[0].status, 'sent')
    assert.equal(emails[0].messageId, 'msg-001')

    collector.stop()
  })

  test('does not match a sending record with a different subject', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ subject: 'Different Subject' }))
    emitter.emit('mail:sent', makeSentData())

    const emails = collector.getEmails()
    assert.lengthOf(emails, 2, 'should create a new record, not update the mismatched one')
    assert.equal(emails[0].status, 'sent')
    assert.equal(emails[1].status, 'sending')

    collector.stop()
  })
})


// ---------------------------------------------------------------------------
// Tests -- getEmails()
// ---------------------------------------------------------------------------

test.group('EmailCollector | getEmails()', () => {
  test('returns all emails in newest-first order', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ subject: 'First' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Second' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Third' }))

    const emails = collector.getEmails()
    assert.lengthOf(emails, 3)
    assert.equal(emails[0].subject, 'Third')
    assert.equal(emails[1].subject, 'Second')
    assert.equal(emails[2].subject, 'First')

    collector.stop()
  })

  test('returns empty array when no emails recorded', ({ assert }) => {
    const collector = new EmailCollector()
    assert.deepEqual(collector.getEmails(), [])
  })
})

// ---------------------------------------------------------------------------
// Tests -- getLatest(n)
// ---------------------------------------------------------------------------

test.group('EmailCollector | getLatest(n)', () => {
  test('returns the most recent n emails', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ subject: 'A' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'B' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'C' }))

    const latest = collector.getLatest(2)
    assert.lengthOf(latest, 2)
    // newest first
    assert.equal(latest[0].subject, 'C')
    assert.equal(latest[1].subject, 'B')

    collector.stop()
  })

  test('returns all emails when n exceeds total count', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ subject: 'Only' }))

    const latest = collector.getLatest(100)
    assert.lengthOf(latest, 1)
    assert.equal(latest[0].subject, 'Only')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- getEmailHtml(id)
// ---------------------------------------------------------------------------

test.group('EmailCollector | getEmailHtml(id)', () => {
  test('returns html field for matching ID', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ html: '<b>Important</b>' }))

    const emails = collector.getEmails()
    const html = collector.getEmailHtml(emails[0].id)
    assert.equal(html, '<b>Important</b>')

    collector.stop()
  })

  test('returns null for non-existent ID', ({ assert }) => {
    const collector = new EmailCollector()
    assert.isNull(collector.getEmailHtml(9999))
  })

  test('returns null when email has no html', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ html: undefined }))

    const emails = collector.getEmails()
    const html = collector.getEmailHtml(emails[0].id)
    assert.isNull(html)

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- getTotalCount()
// ---------------------------------------------------------------------------

test.group('EmailCollector | getTotalCount()', () => {
  test('returns the current buffer size', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    assert.equal(collector.getTotalCount(), 0)

    emitter.emit('mail:sending', makeSendingData())
    assert.equal(collector.getTotalCount(), 1)

    emitter.emit('mail:sending', makeSendingData({ subject: 'Another' }))
    assert.equal(collector.getTotalCount(), 2)

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- getBufferInfo()
// ---------------------------------------------------------------------------

test.group('EmailCollector | getBufferInfo()', () => {
  test('returns current count and max capacity', async ({ assert }) => {
    const collector = new EmailCollector(25)
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData())

    const info = collector.getBufferInfo()
    assert.equal(info.current, 1)
    assert.equal(info.max, 25)

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- clear()
// ---------------------------------------------------------------------------

test.group('EmailCollector | clear()', () => {
  test('resets the buffer to empty', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData())
    emitter.emit('mail:sending', makeSendingData({ subject: 'Two' }))
    assert.equal(collector.getTotalCount(), 2)

    collector.clear()

    assert.equal(collector.getTotalCount(), 0)
    assert.deepEqual(collector.getEmails(), [])

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- stop()
// ---------------------------------------------------------------------------

test.group('EmailCollector | stop()', () => {
  test('unregisters all handlers from the emitter', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    // Verify handlers are registered
    assert.lengthOf(emitter.handlers['mail:sending'], 1)

    collector.stop()

    // Handlers should be removed
    assert.lengthOf(emitter.handlers['mail:sending'] || [], 0)
    assert.lengthOf(emitter.handlers['mail:sent'] || [], 0)
    assert.lengthOf(emitter.handlers['mail:queueing'] || [], 0)
    assert.lengthOf(emitter.handlers['mail:queued'] || [], 0)
    assert.lengthOf(emitter.handlers['queued:mail:error'] || [], 0)
  })

  test('events emitted after stop are not recorded', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData())
    assert.equal(collector.getTotalCount(), 1)

    collector.stop()

    emitter.emit('mail:sending', makeSendingData({ subject: 'After stop' }))
    assert.equal(collector.getTotalCount(), 1)
  })

  test('stop() is safe to call multiple times', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    assert.doesNotThrow(() => {
      collector.stop()
      collector.stop()
    })
  })

  test('stop() is safe to call without start()', ({ assert }) => {
    const collector = new EmailCollector()
    assert.doesNotThrow(() => collector.stop())
  })
})

// ---------------------------------------------------------------------------
// Tests -- HTML truncation
// ---------------------------------------------------------------------------

test.group('EmailCollector | HTML truncation', () => {
  test('HTML bodies larger than 50KB are truncated with "<!-- truncated -->"', async ({
    assert,
  }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const largeHtml = 'x'.repeat(60_000)
    emitter.emit('mail:sending', makeSendingData({ html: largeHtml }))

    const emails = collector.getEmails()
    const html = emails[0].html!
    assert.isTrue(html.length < 60_000, 'HTML should be truncated')
    assert.isTrue(html.endsWith('\n<!-- truncated -->'), 'should end with truncation marker')
    assert.equal(html.length, 50_000 + '\n<!-- truncated -->'.length)

    collector.stop()
  })

  test('HTML bodies at or below 50KB are not truncated', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const html = 'x'.repeat(50_000)
    emitter.emit('mail:sending', makeSendingData({ html }))

    const emails = collector.getEmails()
    assert.equal(emails[0].html, html)
    assert.equal(emails[0].html!.length, 50_000)

    collector.stop()
  })

  test('text bodies larger than 50KB are also truncated', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const largeText = 'y'.repeat(60_000)
    emitter.emit('mail:sending', makeSendingData({ text: largeText }))

    const emails = collector.getEmails()
    const text = emails[0].text!
    assert.isTrue(text.endsWith('\n<!-- truncated -->'))

    collector.stop()
  })

  test('null or empty html is preserved as null', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ html: null }))
    emitter.emit('mail:sending', makeSendingData({ html: '' }))

    const emails = collector.getEmails()
    assert.isNull(emails[0].html) // empty string is falsy, capSize returns null
    assert.isNull(emails[1].html)

    collector.stop()
  })
})

