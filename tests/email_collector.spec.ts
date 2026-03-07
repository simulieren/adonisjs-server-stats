import { test } from '@japa/runner'
import { EmailCollector } from '../src/debug/email_collector.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEmitter() {
  const handlers: Record<string, Function[]> = {}
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
  test('registers handlers for all four mail events', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    assert.isTrue('mail:sending' in emitter.handlers)
    assert.isTrue('mail:sent' in emitter.handlers)
    assert.isTrue('mail:queued' in emitter.handlers)
    assert.isTrue('queued:mail:error' in emitter.handlers)

    assert.lengthOf(emitter.handlers['mail:sending'], 1)
    assert.lengthOf(emitter.handlers['mail:sent'], 1)
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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

    // Two sending events with the same to+subject
    emitter.emit('mail:sending', makeSendingData())
    emitter.emit('mail:sending', makeSendingData())

    // Sent should update the second (most recent) one
    emitter.emit('mail:sent', makeSentData())

    const emails = collector.getEmails()
    assert.lengthOf(emails, 2)
    assert.equal(emails[0].status, 'sending', 'first record should stay as sending')
    assert.equal(emails[1].status, 'sent', 'second record should be updated to sent')

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

    emitter.emit('mail:sending', makeSendingData({ subject: 'Different Subject' }))
    emitter.emit('mail:sent', makeSentData())

    const emails = collector.getEmails()
    assert.lengthOf(emails, 2, 'should create a new record, not update the mismatched one')
    assert.equal(emails[0].status, 'sending')
    assert.equal(emails[1].status, 'sent')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- mail:queued event
// ---------------------------------------------------------------------------

test.group('EmailCollector | mail:queued', () => {
  test('creates a record with status "queued"', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:queued', {
      message: {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Queued Email',
        html: '<p>Queued</p>',
      },
      mailerName: 'ses',
    })

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1)
    assert.equal(emails[0].status, 'queued')
    assert.equal(emails[0].subject, 'Queued Email')
    assert.equal(emails[0].mailer, 'ses')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- queued:mail:error event
// ---------------------------------------------------------------------------

test.group('EmailCollector | queued:mail:error', () => {
  test('creates a record with status "failed"', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('queued:mail:error', {
      message: {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Failed Email',
        html: '<p>Error</p>',
      },
      mailerName: 'smtp',
    })

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1)
    assert.equal(emails[0].status, 'failed')
    assert.equal(emails[0].subject, 'Failed Email')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- getEmails()
// ---------------------------------------------------------------------------

test.group('EmailCollector | getEmails()', () => {
  test('returns all emails in insertion order', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', makeSendingData({ subject: 'First' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Second' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Third' }))

    const emails = collector.getEmails()
    assert.lengthOf(emails, 3)
    assert.equal(emails[0].subject, 'First')
    assert.equal(emails[1].subject, 'Second')
    assert.equal(emails[2].subject, 'Third')

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

    // Verify handlers are registered
    assert.lengthOf(emitter.handlers['mail:sending'], 1)

    collector.stop()

    // Handlers should be removed
    assert.lengthOf(emitter.handlers['mail:sending'] || [], 0)
    assert.lengthOf(emitter.handlers['mail:sent'] || [], 0)
    assert.lengthOf(emitter.handlers['mail:queued'] || [], 0)
    assert.lengthOf(emitter.handlers['queued:mail:error'] || [], 0)
  })

  test('events emitted after stop are not recorded', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', makeSendingData())
    assert.equal(collector.getTotalCount(), 1)

    collector.stop()

    emitter.emit('mail:sending', makeSendingData({ subject: 'After stop' }))
    assert.equal(collector.getTotalCount(), 1)
  })

  test('stop() is safe to call multiple times', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

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
    await collector.start(emitter as any)

    emitter.emit('mail:sending', makeSendingData({ html: null }))
    emitter.emit('mail:sending', makeSendingData({ html: '' }))

    const emails = collector.getEmails()
    assert.isNull(emails[0].html)
    assert.isNull(emails[1].html) // empty string is falsy, capSize returns null

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- Flat message shape
// ---------------------------------------------------------------------------

test.group('EmailCollector | Flat message shape', () => {
  test('handles data.message (nested shape)', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', {
      message: {
        from: 'nested@test.com',
        to: 'to@test.com',
        subject: 'Nested',
        html: '<p>Nested</p>',
      },
      mailerName: 'smtp',
    })

    const emails = collector.getEmails()
    assert.equal(emails[0].from, 'nested@test.com')
    assert.equal(emails[0].subject, 'Nested')

    collector.stop()
  })

  test('handles data itself as message (flat shape)', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    // No `message` property — data IS the message
    emitter.emit('mail:sending', {
      from: 'flat@test.com',
      to: 'to@test.com',
      subject: 'Flat',
      html: '<p>Flat</p>',
      mailerName: 'smtp',
    })

    const emails = collector.getEmails()
    assert.equal(emails[0].from, 'flat@test.com')
    assert.equal(emails[0].subject, 'Flat')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- messageId extraction
// ---------------------------------------------------------------------------

test.group('EmailCollector | messageId extraction', () => {
  test('extracts messageId from data.response.messageId', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sent', {
      message: {
        from: 'sender@test.com',
        to: 'to@test.com',
        subject: 'Test',
      },
      response: { messageId: 'response-id-123' },
    })

    const emails = collector.getEmails()
    assert.equal(emails[0].messageId, 'response-id-123')

    collector.stop()
  })

  test('falls back to data.messageId when data.response.messageId is absent', async ({
    assert,
  }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sent', {
      message: {
        from: 'sender@test.com',
        to: 'to@test.com',
        subject: 'Test',
      },
      messageId: 'fallback-id-456',
    })

    const emails = collector.getEmails()
    assert.equal(emails[0].messageId, 'fallback-id-456')

    collector.stop()
  })

  test('messageId is null when neither source provides it', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sent', {
      message: {
        from: 'sender@test.com',
        to: 'to@test.com',
        subject: 'Test',
      },
    })

    const emails = collector.getEmails()
    assert.isNull(emails[0].messageId)

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- Attachment count
// ---------------------------------------------------------------------------

test.group('EmailCollector | Attachment count', () => {
  test('counts array attachments', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit(
      'mail:sending',
      makeSendingData({
        attachments: [
          { filename: 'a.pdf', content: Buffer.from('') },
          { filename: 'b.png', content: Buffer.from('') },
          { filename: 'c.txt', content: Buffer.from('') },
        ],
      })
    )

    assert.equal(collector.getEmails()[0].attachmentCount, 3)

    collector.stop()
  })

  test('non-array attachments result in 0', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', makeSendingData({ attachments: 'not-an-array' }))
    assert.equal(collector.getEmails()[0].attachmentCount, 0)

    collector.stop()
  })

  test('missing attachments result in 0', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', makeSendingData())
    assert.equal(collector.getEmails()[0].attachmentCount, 0)

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- loadRecords + continued recording (no ID collision)
// ---------------------------------------------------------------------------

test.group('EmailCollector | loadRecords + continued recording', () => {
  test('restores records and resets ID counter to avoid collisions', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    // Simulate previously persisted records
    const persisted = [
      {
        id: 10,
        from: 'old@test.com',
        to: 'to@test.com',
        cc: null,
        bcc: null,
        subject: 'Old Email',
        html: '<p>Old</p>',
        text: 'Old',
        mailer: 'smtp',
        status: 'sent' as const,
        messageId: 'old-msg-id',
        attachmentCount: 0,
        timestamp: Date.now() - 60_000,
      },
      {
        id: 20,
        from: 'old2@test.com',
        to: 'to@test.com',
        cc: null,
        bcc: null,
        subject: 'Old Email 2',
        html: '<p>Old 2</p>',
        text: 'Old 2',
        mailer: 'smtp',
        status: 'sent' as const,
        messageId: 'old-msg-id-2',
        attachmentCount: 0,
        timestamp: Date.now() - 30_000,
      },
    ]

    collector.loadRecords(persisted)

    assert.equal(collector.getTotalCount(), 2)

    // Now record a new email — its ID should be > 20
    emitter.emit('mail:sending', makeSendingData({ subject: 'New Email' }))

    const emails = collector.getEmails()
    assert.lengthOf(emails, 3)

    const newEmail = emails[2]
    assert.equal(newEmail.subject, 'New Email')
    assert.isTrue(newEmail.id > 20, `Expected id > 20 but got ${newEmail.id}`)

    collector.stop()
  })

  test('loaded records are accessible via getEmails()', ({ assert }) => {
    const collector = new EmailCollector()

    const record = {
      id: 5,
      from: 'loaded@test.com',
      to: 'to@test.com',
      cc: null,
      bcc: null,
      subject: 'Loaded',
      html: null,
      text: null,
      mailer: 'smtp',
      status: 'sent' as const,
      messageId: null,
      attachmentCount: 0,
      timestamp: Date.now(),
    }

    collector.loadRecords([record])

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1)
    assert.equal(emails[0].from, 'loaded@test.com')
    assert.equal(emails[0].id, 5)
  })
})

// ---------------------------------------------------------------------------
// Tests -- onNewItem callback
// ---------------------------------------------------------------------------

test.group('EmailCollector | onNewItem callback', () => {
  test('fires callback on each new email', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    const captured: unknown[] = []
    collector.onNewItem((item) => captured.push(item))

    emitter.emit('mail:sending', makeSendingData({ subject: 'CB 1' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'CB 2' }))

    assert.lengthOf(captured, 2)
    assert.equal((captured[0] as any).subject, 'CB 1')
    assert.equal((captured[1] as any).subject, 'CB 2')

    collector.stop()
  })

  test('passing null removes the callback', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    const captured: unknown[] = []
    collector.onNewItem((item) => captured.push(item))

    emitter.emit('mail:sending', makeSendingData({ subject: 'Before' }))
    assert.lengthOf(captured, 1)

    collector.onNewItem(null)

    emitter.emit('mail:sending', makeSendingData({ subject: 'After' }))
    assert.lengthOf(captured, 1, 'callback should not fire after being removed')

    collector.stop()
  })

  test('callback fires for mail:sent that creates a new record (no match)', async ({
    assert,
  }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    const captured: unknown[] = []
    collector.onNewItem((item) => captured.push(item))

    emitter.emit('mail:sent', makeSentData())

    assert.lengthOf(captured, 1)
    assert.equal((captured[0] as any).status, 'sent')

    collector.stop()
  })

  test('callback does NOT fire again when mail:sent updates an existing record in-place', async ({
    assert,
  }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    const captured: unknown[] = []
    collector.onNewItem((item) => captured.push(item))

    emitter.emit('mail:sending', makeSendingData())
    // This should match the sending record and update it in-place — no new push
    emitter.emit('mail:sent', makeSentData())

    assert.lengthOf(captured, 1, 'only the sending push should trigger callback')
    // The captured object is the same reference as the record in the buffer.
    // Because mail:sent mutates match.status in-place, the captured reference
    // now reflects 'sent'. This confirms only one push happened.
    assert.equal((captured[0] as any).status, 'sent')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- start() with invalid emitter
// ---------------------------------------------------------------------------

test.group('EmailCollector | start() with invalid emitter', () => {
  test('null emitter does not throw', async ({ assert }) => {
    const collector = new EmailCollector()
    await assert.doesNotReject(() => collector.start(null as any))
  })

  test('undefined emitter does not throw', async ({ assert }) => {
    const collector = new EmailCollector()
    await assert.doesNotReject(() => collector.start(undefined as any))
  })

  test('emitter without .on method does not throw', async ({ assert }) => {
    const collector = new EmailCollector()
    await assert.doesNotReject(() => collector.start({} as any))
  })

  test('emitter with .on as non-function does not throw', async ({ assert }) => {
    const collector = new EmailCollector()
    await assert.doesNotReject(() => collector.start({ on: 'not-a-function' } as any))
  })
})

// ---------------------------------------------------------------------------
// Tests -- mailer name extraction
// ---------------------------------------------------------------------------

test.group('EmailCollector | mailer name extraction', () => {
  test('uses mailerName when available', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Test' },
      mailerName: 'ses',
    })

    assert.equal(collector.getEmails()[0].mailer, 'ses')

    collector.stop()
  })

  test('falls back to data.mailer when mailerName is absent', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Test' },
      mailer: 'mailgun',
    })

    assert.equal(collector.getEmails()[0].mailer, 'mailgun')

    collector.stop()
  })

  test('defaults to "unknown" when neither mailerName nor mailer is set', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Test' },
    })

    assert.equal(collector.getEmails()[0].mailer, 'unknown')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- Ring buffer overflow
// ---------------------------------------------------------------------------

test.group('EmailCollector | Ring buffer overflow', () => {
  test('oldest emails are evicted when capacity is exceeded', async ({ assert }) => {
    const collector = new EmailCollector(3)
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 1' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 2' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 3' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 4' }))

    assert.equal(collector.getTotalCount(), 3)

    const emails = collector.getEmails()
    assert.equal(emails[0].subject, 'Email 2')
    assert.equal(emails[1].subject, 'Email 3')
    assert.equal(emails[2].subject, 'Email 4')

    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- Address extraction via extractAddresses
// ---------------------------------------------------------------------------

test.group('EmailCollector | Address extraction', () => {
  test('extracts address from { address } object', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit(
      'mail:sending',
      makeSendingData({
        from: { address: 'obj@test.com', name: 'Obj Sender' },
      })
    )

    assert.equal(collector.getEmails()[0].from, 'obj@test.com')

    collector.stop()
  })

  test('handles mixed array of strings and objects', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as any)

    emitter.emit(
      'mail:sending',
      makeSendingData({
        to: ['a@test.com', { address: 'b@test.com' }],
      })
    )

    assert.equal(collector.getEmails()[0].to, 'a@test.com, b@test.com')

    collector.stop()
  })
})
