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
// Tests -- HTML truncation
// ---------------------------------------------------------------------------

test.group('EmailCollector | HTML truncation (large)', () => {
  test('HTML bodies larger than 50KB are truncated', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const largeHtml = 'x'.repeat(60_000)
    emitter.emit('mail:sending', makeSendingData({ html: largeHtml }))

    const html = collector.getEmails()[0].html!
    assert.isTrue(html.length < 60_000)
    assert.isTrue(html.endsWith('\n<!-- truncated -->'))
    assert.equal(html.length, 50_000 + '\n<!-- truncated -->'.length)
    collector.stop()
  })

  test('HTML bodies at or below 50KB are not truncated', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const html = 'x'.repeat(50_000)
    emitter.emit('mail:sending', makeSendingData({ html }))

    assert.equal(collector.getEmails()[0].html, html)
    collector.stop()
  })
})

test.group('EmailCollector | HTML truncation (text & null)', () => {
  test('text bodies larger than 50KB are also truncated', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const largeText = 'y'.repeat(60_000)
    emitter.emit('mail:sending', makeSendingData({ text: largeText }))

    const text = collector.getEmails()[0].text!
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
    assert.isNull(emails[0].html)
    assert.isNull(emails[1].html)
    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- loadRecords + continued recording (no ID collision)
// ---------------------------------------------------------------------------

test.group('EmailCollector | loadRecords + continued recording', () => {
  test('restores records and resets ID counter', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const persisted = [
      {
        id: 10, from: 'old@test.com', to: 'to@test.com',
        cc: null, bcc: null, subject: 'Old Email',
        html: '<p>Old</p>', text: 'Old', mailer: 'smtp',
        status: 'sent' as const, messageId: 'old-msg-id',
        attachmentCount: 0, timestamp: Date.now() - 60_000,
      },
      {
        id: 20, from: 'old2@test.com', to: 'to@test.com',
        cc: null, bcc: null, subject: 'Old Email 2',
        html: '<p>Old 2</p>', text: 'Old 2', mailer: 'smtp',
        status: 'sent' as const, messageId: 'old-msg-id-2',
        attachmentCount: 0, timestamp: Date.now() - 30_000,
      },
    ]
    collector.loadRecords(persisted)
    assert.equal(collector.getTotalCount(), 2)

    emitter.emit('mail:sending', makeSendingData({ subject: 'New Email' }))
    const emails = collector.getEmails()
    assert.lengthOf(emails, 3)
    assert.isTrue(emails[0].id > 20, `Expected id > 20 but got ${emails[0].id}`)
    collector.stop()
  })

  test('loaded records are accessible via getEmails()', ({ assert }) => {
    const collector = new EmailCollector()
    const record = {
      id: 5, from: 'loaded@test.com', to: 'to@test.com',
      cc: null, bcc: null, subject: 'Loaded',
      html: null, text: null, mailer: 'smtp',
      status: 'sent' as const, messageId: null,
      attachmentCount: 0, timestamp: Date.now(),
    }
    collector.loadRecords([record])

    const emails = collector.getEmails()
    assert.lengthOf(emails, 1)
    assert.equal(emails[0].from, 'loaded@test.com')
  })
})

// ---------------------------------------------------------------------------
// Tests -- onNewItem callback
// ---------------------------------------------------------------------------

test.group('EmailCollector | onNewItem callback (basic)', () => {
  test('fires callback on each new email', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const captured: unknown[] = []
    collector.onNewItem((item) => captured.push(item))

    emitter.emit('mail:sending', makeSendingData({ subject: 'CB 1' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'CB 2' }))

    assert.lengthOf(captured, 2)
    assert.equal((captured[0] as unknown as Record<string, unknown>).subject, 'CB 1')
    collector.stop()
  })

  test('passing null removes the callback', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const captured: unknown[] = []
    collector.onNewItem((item) => captured.push(item))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Before' }))
    assert.lengthOf(captured, 1)

    collector.onNewItem(null)
    emitter.emit('mail:sending', makeSendingData({ subject: 'After' }))
    assert.lengthOf(captured, 1)
    collector.stop()
  })
})

test.group('EmailCollector | onNewItem callback (sent)', () => {
  test('fires for mail:sent that creates a new record', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const captured: unknown[] = []
    collector.onNewItem((item) => captured.push(item))
    emitter.emit('mail:sent', makeSentData())

    assert.lengthOf(captured, 1)
    assert.equal((captured[0] as unknown as Record<string, unknown>).status, 'sent')
    collector.stop()
  })

  test('does NOT fire again when mail:sent updates existing', async ({ assert }) => {
    const collector = new EmailCollector()
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    const captured: unknown[] = []
    collector.onNewItem((item) => captured.push(item))

    emitter.emit('mail:sending', makeSendingData())
    emitter.emit('mail:sent', makeSentData())

    assert.lengthOf(captured, 1, 'only the sending push should trigger callback')
    assert.equal((captured[0] as unknown as Record<string, unknown>).status, 'sent')
    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- Ring buffer overflow
// ---------------------------------------------------------------------------

test.group('EmailCollector | Ring buffer overflow', () => {
  test('oldest emails are evicted when capacity exceeded', async ({ assert }) => {
    const collector = new EmailCollector(3)
    const emitter = createMockEmitter()
    await collector.start(emitter as unknown as Emitter)

    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 1' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 2' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 3' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 4' }))

    assert.equal(collector.getTotalCount(), 3)
    const emails = collector.getEmails()
    assert.equal(emails[0].subject, 'Email 4')
    assert.equal(emails[2].subject, 'Email 2')
    collector.stop()
  })
})

// ---------------------------------------------------------------------------
// Tests -- start() with invalid emitter
// ---------------------------------------------------------------------------

test.group('EmailCollector | start() with invalid emitter', () => {
  test('null emitter does not throw', async ({ assert }) => {
    const collector = new EmailCollector()
    await assert.doesNotReject(() => collector.start(null as unknown as Emitter))
  })

  test('undefined emitter does not throw', async ({ assert }) => {
    const collector = new EmailCollector()
    await assert.doesNotReject(() => collector.start(undefined as unknown as Emitter))
  })

  test('emitter without .on method does not throw', async ({ assert }) => {
    const collector = new EmailCollector()
    await assert.doesNotReject(() => collector.start({} as unknown as Emitter))
  })

  test('emitter with .on as non-function does not throw', async ({ assert }) => {
    const collector = new EmailCollector()
    await assert.doesNotReject(() => collector.start({ on: 'not-a-function' } as unknown as Emitter))
  })
})
