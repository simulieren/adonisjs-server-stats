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

function _makeSentData(overrides: Record<string, unknown> = {}) {
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
// Tests -- mail:queueing event
// ---------------------------------------------------------------------------

test.group('EmailCollector | mail:queueing', () => {
  test('creates a record with status "queueing"', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:queueing', {
      message: {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Queueing Email',
        html: '<p>Queueing</p>',
      },
      mailerName: 'ses',
    })

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1)
    assert.equal(emails[0].status, 'queueing')
    assert.equal(emails[0].subject, 'Queueing Email')
    assert.equal(emails[0].mailer, 'ses')
    collector.stop()
  })

  test('mail:queued updates matching queueing record to queued', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:queueing', {
      message: { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Test Email' },
      mailerName: 'ses',
    })
    emitter.emit('mail:queued', {
      message: { from: 'sender@example.com', to: 'recipient@example.com', subject: 'Test Email' },
      mailerName: 'ses',
    })

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1)
    assert.equal(emails[0].status, 'queued')
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
    await collector.start(emitter as unknown as Emitter)

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
    await collector.start(emitter as unknown as Emitter)

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
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', {
      message: { from: 'nested@test.com', to: 'to@test.com', subject: 'Nested', html: '<p>Nested</p>' },
      mailerName: 'smtp',
    })

    assert.equal(collector.getEmails()[0].from, 'nested@test.com')
    collector.stop()
  })

  test('handles data itself as message (flat shape)', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', {
      from: 'flat@test.com',
      to: 'to@test.com',
      subject: 'Flat',
      html: '<p>Flat</p>',
      mailerName: 'smtp',
    })

    assert.equal(collector.getEmails()[0].from, 'flat@test.com')
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
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sent', {
      message: { from: 'sender@test.com', to: 'to@test.com', subject: 'Test' },
      response: { messageId: 'response-id-123' },
    })

    assert.equal(collector.getEmails()[0].messageId, 'response-id-123')
    collector.stop()
  })

  test('falls back to data.messageId', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sent', {
      message: { from: 'sender@test.com', to: 'to@test.com', subject: 'Test' },
      messageId: 'fallback-id-456',
    })

    assert.equal(collector.getEmails()[0].messageId, 'fallback-id-456')
    collector.stop()
  })

  test('messageId is null when neither source provides it', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sent', {
      message: { from: 'sender@test.com', to: 'to@test.com', subject: 'Test' },
    })

    assert.isNull(collector.getEmails()[0].messageId)
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
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({
      attachments: [
        { filename: 'a.pdf', content: Buffer.from('') },
        { filename: 'b.png', content: Buffer.from('') },
        { filename: 'c.txt', content: Buffer.from('') },
      ],
    }))

    assert.equal(collector.getEmails()[0].attachmentCount, 3)
    collector.stop()
  })

  test('non-array attachments result in 0', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ attachments: 'not-an-array' }))
    assert.equal(collector.getEmails()[0].attachmentCount, 0)
    collector.stop()
  })

  test('missing attachments result in 0', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData())
    assert.equal(collector.getEmails()[0].attachmentCount, 0)
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
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({
      from: { address: 'obj@test.com', name: 'Obj Sender' },
    }))

    assert.equal(collector.getEmails()[0].from, 'obj@test.com')
    collector.stop()
  })

  test('handles mixed array of strings and objects', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({
      to: ['a@test.com', { address: 'b@test.com' }],
    }))

    assert.equal(collector.getEmails()[0].to, 'a@test.com, b@test.com')
    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- mailer name extraction
// ---------------------------------------------------------------------------

test.group('EmailCollector | mailer name extraction', () => {
  test('uses mailerName when available', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

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
    await collector.start(emitter as unknown as Emitter)

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
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Test' },
    })

    assert.equal(collector.getEmails()[0].mailer, 'unknown')
    collector.stop()
  })
})
