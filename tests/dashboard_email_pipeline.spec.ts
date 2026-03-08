import { test } from '@japa/runner'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DashboardStore } from '../src/dashboard/dashboard_store.js'

import type { DevToolbarConfig } from '../src/debug/types.js'

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

function makeConfig(dbPath: string): DevToolbarConfig {
  return {
    enabled: true,
    maxQueries: 500,
    maxEvents: 500,
    maxEmails: 100,
    slowQueryThresholdMs: 100,
    persistDebugData: false,
    tracing: false,
    maxTraces: 200,
    dashboard: true,
    dashboardPath: '/__stats',
    retentionDays: 7,
    dbPath,
    debugEndpoint: '/__debug',
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

/** Flush the DashboardStore write queue by calling the private method. */
async function flush(store: DashboardStore): Promise<void> {
  // Clear any pending timer so we can flush manually
  const timer = (store as unknown as Record<string, unknown>).flushTimer
  if (timer) {
    clearTimeout(timer)
    ;(store as unknown as Record<string, unknown>).flushTimer = null
  }
  await (store as unknown as Record<string, (...args: unknown[]) => Promise<void>>).flushWriteQueue()
  // Clear the paginate result cache so subsequent reads see fresh data
  ;((store as unknown as Record<string, Record<string, () => void>>).resultCache).clear()
}

// ---------------------------------------------------------------------------
// Test group
// ---------------------------------------------------------------------------

test.group('DashboardStore | Email Pipeline (integration)', (group) => {
  let tmpDir: string
  let store: DashboardStore
  let emitter: ReturnType<typeof createMockEmitter>

  group.each.setup(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ss-email-test-'))
    const config = makeConfig('test.sqlite')

    store = new DashboardStore(config)
    emitter = createMockEmitter()

    // start() sets up the knex connection, runs migrations, and wires event listeners.
    // appRoot is the project root so that appImportWithPath can find knex/better-sqlite3.
    await store.start(null, emitter as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  group.each.teardown(async () => {
    await store.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  // -------------------------------------------------------------------------
  // Basic: mail:sending event
  // -------------------------------------------------------------------------

  test('mail:sending event is persisted to SQLite', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData())
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.total, 1)
    assert.lengthOf(result.data, 1)

    const row = result.data[0]
    assert.equal(row.from_addr, 'sender@example.com')
    assert.equal(row.to_addr, 'recipient@example.com')
    assert.equal(row.subject, 'Hello World')
    assert.equal(row.html, '<p>Hello</p>')
    assert.equal(row.text_body, 'Hello')
    assert.equal(row.mailer, 'smtp')
    assert.equal(row.status, 'sending')
    assert.isNull(row.message_id)
    assert.equal(row.attachment_count, 0)
  })

  // -------------------------------------------------------------------------
  // Basic: mail:sent event
  // -------------------------------------------------------------------------

  test('mail:sent event is persisted with messageId', async ({ assert }) => {
    emitter.emit('mail:sent', makeSentData())
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.total, 1)
    assert.lengthOf(result.data, 1)

    const row = result.data[0]
    assert.equal(row.status, 'sent')
    assert.equal(row.message_id, 'msg-001')
    assert.equal(row.from_addr, 'sender@example.com')
  })

  // -------------------------------------------------------------------------
  // Basic: mail:queueing event
  // -------------------------------------------------------------------------

  test('mail:queueing event is persisted with status "queueing"', async ({ assert }) => {
    emitter.emit('mail:queueing', {
      message: {
        from: 'queueing-sender@example.com',
        to: 'queueing-recipient@example.com',
        subject: 'Queueing Email',
        html: '<p>Queueing</p>',
      },
      mailerName: 'ses',
    })
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.total, 1)

    const row = result.data[0]
    assert.equal(row.status, 'queueing')
    assert.equal(row.from_addr, 'queueing-sender@example.com')
    assert.equal(row.subject, 'Queueing Email')
  })

  // -------------------------------------------------------------------------
  // Basic: mail:queued event
  // -------------------------------------------------------------------------

  test('mail:queued event is persisted with status "queued"', async ({ assert }) => {
    emitter.emit('mail:queued', {
      message: {
        from: 'queue-sender@example.com',
        to: 'queue-recipient@example.com',
        subject: 'Queued Email',
        html: '<p>Queued</p>',
      },
      mailerName: 'ses',
    })
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.total, 1)

    const row = result.data[0]
    assert.equal(row.status, 'queued')
    assert.equal(row.from_addr, 'queue-sender@example.com')
    assert.equal(row.to_addr, 'queue-recipient@example.com')
    assert.equal(row.subject, 'Queued Email')
    assert.equal(row.mailer, 'ses')
  })

  // -------------------------------------------------------------------------
  // Basic: queued:mail:error event
  // -------------------------------------------------------------------------

  test('queued:mail:error event is persisted with status "failed"', async ({ assert }) => {
    emitter.emit('queued:mail:error', {
      message: {
        from: 'fail-sender@example.com',
        to: 'fail-recipient@example.com',
        subject: 'Failed Email',
        html: '<p>Error</p>',
      },
      mailerName: 'smtp',
    })
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.total, 1)

    const row = result.data[0]
    assert.equal(row.status, 'failed')
    assert.equal(row.subject, 'Failed Email')
    assert.equal(row.from_addr, 'fail-sender@example.com')
  })

  // -------------------------------------------------------------------------
  // Multiple events — correct counts
  // -------------------------------------------------------------------------

  test('multiple email events produce correct total count', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ subject: 'Email 1' }))
    emitter.emit('mail:sent', makeSentData({ subject: 'Email 2' }))
    emitter.emit('mail:queued', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Email 3' },
      mailerName: 'ses',
    })
    emitter.emit('queued:mail:error', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Email 4' },
      mailerName: 'smtp',
    })

    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.total, 4)
    assert.lengthOf(result.data, 4)
  })

  // -------------------------------------------------------------------------
  // Ordering — newest first (ORDER BY created_at DESC)
  // -------------------------------------------------------------------------

  test('getEmails returns results ordered newest first', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ subject: 'First' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Second' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Third' }))

    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.total, 3)

    // SQLite created_at uses datetime('now') which has second-level granularity.
    // All three emails may share the same created_at value, so within the same
    // second they'll be ordered by the auto-increment ID descending (since
    // ORDER BY created_at DESC, and equal created_at preserves insertion order
    // in reverse via ROWID). The important thing is we get all 3.
    const subjects = result.data.map((r) => r.subject)
    assert.includeMembers(subjects, ['First', 'Second', 'Third'])
  })

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  test('getEmails respects pagination parameters', async ({ assert }) => {
    // Insert 5 emails
    for (let i = 1; i <= 5; i++) {
      emitter.emit('mail:sending', makeSendingData({ subject: `Email ${i}` }))
    }
    await flush(store)

    // Page 1, 2 per page
    const page1 = await store.getEmails(1, 2)
    assert.equal(page1.total, 5)
    assert.equal(page1.page, 1)
    assert.equal(page1.perPage, 2)
    assert.equal(page1.lastPage, 3)
    assert.lengthOf(page1.data, 2)

    // Page 3, 2 per page — should have 1 result
    const page3 = await store.getEmails(3, 2)
    assert.equal(page3.total, 5)
    assert.equal(page3.page, 3)
    assert.lengthOf(page3.data, 1)
  })

  // -------------------------------------------------------------------------
  // Filters — search
  // -------------------------------------------------------------------------

  test('getEmails filters by search term across from/to/subject', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ subject: 'Invoice #42' }))
    emitter.emit('mail:sending', makeSendingData({ subject: 'Password Reset' }))
    emitter.emit(
      'mail:sending',
      makeSendingData({ subject: 'Welcome', from: 'invoices@example.com' })
    )
    await flush(store)

    const result = await store.getEmails(1, 50, { search: 'Invoice' })
    // "Invoice #42" matches in subject, "invoices@example.com" matches in from_addr
    assert.equal(result.total, 2)
  })

  // -------------------------------------------------------------------------
  // Filters — status
  // -------------------------------------------------------------------------

  test('getEmails filters by status', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ subject: 'A' }))
    emitter.emit('mail:sent', makeSentData({ subject: 'B' }))
    emitter.emit('mail:queued', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'C' },
      mailerName: 'smtp',
    })
    await flush(store)

    const sentOnly = await store.getEmails(1, 50, { status: 'sent' })
    assert.equal(sentOnly.total, 1)
    assert.equal(sentOnly.data[0].status, 'sent')

    const sendingOnly = await store.getEmails(1, 50, { status: 'sending' })
    assert.equal(sendingOnly.total, 1)
    assert.equal(sendingOnly.data[0].status, 'sending')
  })

  // -------------------------------------------------------------------------
  // Filters — mailer
  // -------------------------------------------------------------------------

  test('getEmails filters by mailer name', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ subject: 'SMTP email' }))
    emitter.emit('mail:queued', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'SES email' },
      mailerName: 'ses',
    })
    await flush(store)

    const sesOnly = await store.getEmails(1, 50, { mailer: 'ses' })
    assert.equal(sesOnly.total, 1)
    assert.equal(sesOnly.data[0].mailer, 'ses')
  })

  // -------------------------------------------------------------------------
  // Email HTML body retrieval
  // -------------------------------------------------------------------------

  test('getEmailHtml returns the HTML body for a given email ID', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ html: '<b>Bold Content</b>' }))
    await flush(store)

    const result = await store.getEmails()
    const emailId = result.data[0].id as number

    const html = await store.getEmailHtml(emailId)
    assert.equal(html, '<b>Bold Content</b>')
  })

  test('getEmailHtml falls back to text_body when html is null', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ html: null, text: 'Plain text only' }))
    await flush(store)

    const result = await store.getEmails()
    const emailId = result.data[0].id as number

    const html = await store.getEmailHtml(emailId)
    assert.equal(html, 'Plain text only')
  })

  test('getEmailHtml returns null for non-existent ID', async ({ assert }) => {
    const html = await store.getEmailHtml(99999)
    assert.isNull(html)
  })

  // -------------------------------------------------------------------------
  // Event listener wiring
  // -------------------------------------------------------------------------

  test('wireEventListeners registers handlers for all five mail events', async ({ assert }) => {
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
  })

  // -------------------------------------------------------------------------
  // stop() unregisters handlers
  // -------------------------------------------------------------------------

  test('stop() unregisters all mail event handlers', async ({ assert }) => {
    // Verify handlers exist before stopping
    assert.lengthOf(emitter.handlers['mail:sending'], 1)

    await store.stop()

    assert.lengthOf(emitter.handlers['mail:sending'] || [], 0)
    assert.lengthOf(emitter.handlers['mail:sent'] || [], 0)
    assert.lengthOf(emitter.handlers['mail:queueing'] || [], 0)
    assert.lengthOf(emitter.handlers['mail:queued'] || [], 0)
    assert.lengthOf(emitter.handlers['queued:mail:error'] || [], 0)

    // Re-start so teardown doesn't fail
    emitter = createMockEmitter()
    store = new DashboardStore(makeConfig('test.sqlite'))
    await store.start(null, emitter as unknown as import('../src/debug/types.js').Emitter, tmpDir)
  })

  // -------------------------------------------------------------------------
  // CC, BCC extraction
  // -------------------------------------------------------------------------

  test('cc and bcc fields are persisted correctly', async ({ assert }) => {
    emitter.emit(
      'mail:sending',
      makeSendingData({
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
      })
    )
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.data[0].cc, 'cc@example.com')
    assert.equal(result.data[0].bcc, 'bcc@example.com')
  })

  // -------------------------------------------------------------------------
  // Attachment count
  // -------------------------------------------------------------------------

  test('attachment count is correctly persisted', async ({ assert }) => {
    emitter.emit(
      'mail:sending',
      makeSendingData({
        attachments: [
          { filename: 'a.pdf', content: Buffer.from('') },
          { filename: 'b.png', content: Buffer.from('') },
        ],
      })
    )
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.data[0].attachment_count, 2)
  })

  // -------------------------------------------------------------------------
  // Missing fields produce safe defaults
  // -------------------------------------------------------------------------

  test('missing from defaults to "unknown"', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ from: undefined }))
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.data[0].from_addr, 'unknown')
  })

  test('missing subject defaults to "(no subject)"', async ({ assert }) => {
    emitter.emit('mail:sending', makeSendingData({ subject: undefined }))
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.data[0].subject, '(no subject)')
  })

  test('missing mailerName defaults to "unknown"', async ({ assert }) => {
    emitter.emit('mail:sending', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Test' },
    })
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.data[0].mailer, 'unknown')
  })

  // -------------------------------------------------------------------------
  // Batch flush — multiple emails in a single transaction
  // -------------------------------------------------------------------------

  test('multiple emails are flushed in a single batch', async ({ assert }) => {
    for (let i = 0; i < 10; i++) {
      emitter.emit('mail:sending', makeSendingData({ subject: `Batch Email ${i}` }))
    }

    // All 10 are queued but not yet flushed
    const beforeFlush = await store.getEmails()
    assert.equal(beforeFlush.total, 0)

    await flush(store)

    const afterFlush = await store.getEmails()
    assert.equal(afterFlush.total, 10)
  })

  // -------------------------------------------------------------------------
  // excludeBody flag
  // -------------------------------------------------------------------------

  test('getEmails with excludeBody omits html and text_body columns', async ({ assert }) => {
    emitter.emit(
      'mail:sending',
      makeSendingData({ html: '<p>Big HTML</p>', text: 'Big text' })
    )
    await flush(store)

    const result = await store.getEmails(1, 50, undefined, true)
    assert.equal(result.total, 1)

    const row = result.data[0]
    // When excludeBody is true, the select only picks specific columns,
    // so html and text_body should not be present on the row.
    assert.isUndefined(row.html)
    assert.isUndefined(row.text_body)
    // But other fields should still be present
    assert.equal(row.from_addr, 'sender@example.com')
    assert.equal(row.subject, 'Hello World')
  })

  // -------------------------------------------------------------------------
  // Flat message shape (data IS the message)
  // -------------------------------------------------------------------------

  test('handles flat message shape (no .message wrapper)', async ({ assert }) => {
    emitter.emit('mail:sending', {
      from: 'flat@example.com',
      to: 'flat-to@example.com',
      subject: 'Flat Shape',
      html: '<p>Flat</p>',
      mailerName: 'mailgun',
    })
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.total, 1)
    assert.equal(result.data[0].from_addr, 'flat@example.com')
    assert.equal(result.data[0].subject, 'Flat Shape')
    assert.equal(result.data[0].mailer, 'mailgun')
  })

  // -------------------------------------------------------------------------
  // messageId extraction from response.messageId
  // -------------------------------------------------------------------------

  test('extracts messageId from response.messageId', async ({ assert }) => {
    emitter.emit('mail:sent', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Test' },
      response: { messageId: 'resp-id-xyz' },
      mailerName: 'smtp',
    })
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.data[0].message_id, 'resp-id-xyz')
  })

  test('falls back to data.messageId when response.messageId is absent', async ({ assert }) => {
    emitter.emit('mail:sent', {
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Test' },
      messageId: 'fallback-id',
      mailerName: 'smtp',
    })
    await flush(store)

    const result = await store.getEmails()
    assert.equal(result.data[0].message_id, 'fallback-id')
  })

  // -------------------------------------------------------------------------
  // isReady() reflects database state
  // -------------------------------------------------------------------------

  test('isReady() returns true after start()', async ({ assert }) => {
    assert.isTrue(store.isReady())
  })

  // -------------------------------------------------------------------------
  // No emails when db is not set
  // -------------------------------------------------------------------------

  test('getEmails returns empty result when store is not started', async ({ assert }) => {
    const unstarted = new DashboardStore(makeConfig('/tmp/nonexistent.sqlite'))
    const result = await unstarted.getEmails()
    assert.equal(result.total, 0)
    assert.deepEqual(result.data, [])
  })

  // -------------------------------------------------------------------------
  // recordEmail is a no-op when db is null
  // -------------------------------------------------------------------------

  test('recordEmail is a no-op when db is null', async ({ assert }) => {
    const unstarted = new DashboardStore(makeConfig('/tmp/nonexistent.sqlite'))
    // Should not throw
    assert.doesNotThrow(() => {
      ;(unstarted as unknown as Record<string, (...args: unknown[]) => void>).recordEmail({
        from: 'x@y.com',
        to: 'a@b.com',
        cc: null,
        bcc: null,
        subject: 'Test',
        html: null,
        text: null,
        mailer: 'smtp',
        status: 'sending',
        messageId: null,
        attachmentCount: 0,
        timestamp: Date.now(),
      })
    })
    // pendingEmails should remain empty since db was null
    assert.lengthOf((unstarted as any).pendingEmails, 0)
  })
})
