import { test } from '@japa/runner'
import {
  ingestRemoteEmail,
  registerMailEventPublisher,
  type EmailBridgeTargets,
} from '../src/provider/email_bridge.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A captured email message published over the bridge. */
function sampleMessage(tag: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    _t: tag,
    from: 'dev@example.com',
    to: 'alice@example.com',
    cc: null,
    bcc: null,
    subject: 'Welcome Alice',
    html: '<h1>Hi Alice</h1>',
    text: null,
    mailer: 'smtp',
    status: 'sent',
    messageId: 'm-1',
    attachmentCount: 0,
    timestamp: 1700000000000,
    ...overrides,
  })
}

function makeTargets() {
  const debug: Record<string, unknown>[] = []
  const dashboard: Record<string, unknown>[] = []
  return {
    debug,
    dashboard,
    debugEmails: { ingest: (r: Record<string, unknown>) => debug.push(r) },
    dashboardSink: { recordEmail: (r: Record<string, unknown>) => dashboard.push(r) },
  }
}

/** Let the fire-and-forget async dashboard write settle. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// ingestRemoteEmail
// ---------------------------------------------------------------------------

test.group('email_bridge · ingestRemoteEmail', () => {
  test('skips messages from the same process', async ({ assert }) => {
    const t = makeTargets()
    const targets: EmailBridgeTargets = {
      debugEmails: t.debugEmails,
      dashboardStore: t.dashboardSink,
    }
    ingestRemoteEmail(sampleMessage('me'), 'me', targets)
    await flush()
    assert.lengthOf(t.debug, 0)
    assert.lengthOf(t.dashboard, 0)
  })

  test('ingests remote messages into the in-memory debug collector', async ({ assert }) => {
    const t = makeTargets()
    const targets: EmailBridgeTargets = {
      debugEmails: t.debugEmails,
      dashboardStore: null,
    }
    ingestRemoteEmail(sampleMessage('worker'), 'web', targets)
    await flush()
    assert.lengthOf(t.debug, 1)
    assert.equal(t.debug[0].subject, 'Welcome Alice')
    assert.equal(t.debug[0].to, 'alice@example.com')
    // _t process tag is stripped before storing
    assert.notProperty(t.debug[0], '_t')
  })

  test('persists remote messages via a direct dashboard sink', async ({ assert }) => {
    const t = makeTargets()
    const targets: EmailBridgeTargets = {
      debugEmails: t.debugEmails,
      dashboardStore: t.dashboardSink,
    }
    ingestRemoteEmail(sampleMessage('worker'), 'web', targets)
    await flush()
    assert.lengthOf(t.dashboard, 1)
    assert.equal(t.dashboard[0].subject, 'Welcome Alice')
    // recordEmail receives an id placeholder (SQLite assigns the real one)
    assert.equal(t.dashboard[0].id, 0)
  })

  test('resolves a lazily-bound dashboard store getter (cross-process → SQLite)', async ({
    assert,
  }) => {
    const t = makeTargets()
    let resolved = 0
    const targets: EmailBridgeTargets = {
      debugEmails: t.debugEmails,
      // The bridge subscribes before the SQLite store exists, so the store
      // is provided as a getter resolved at ingest time.
      dashboardStore: () => {
        resolved++
        return t.dashboardSink
      },
    }
    ingestRemoteEmail(sampleMessage('worker'), 'web', targets)
    await flush()
    assert.isAbove(resolved, 0)
    assert.lengthOf(t.dashboard, 1)
    assert.equal(t.dashboard[0].subject, 'Welcome Alice')
  })

  test('tolerates an async getter that resolves to null', async ({ assert }) => {
    const t = makeTargets()
    const targets: EmailBridgeTargets = {
      debugEmails: t.debugEmails,
      dashboardStore: async () => null,
    }
    ingestRemoteEmail(sampleMessage('worker'), 'web', targets)
    await flush()
    // debug capture still happens; no throw despite the null sink
    assert.lengthOf(t.debug, 1)
    assert.lengthOf(t.dashboard, 0)
  })

  test('ignores malformed JSON without throwing', async ({ assert }) => {
    const t = makeTargets()
    const targets: EmailBridgeTargets = {
      debugEmails: t.debugEmails,
      dashboardStore: t.dashboardSink,
    }
    assert.doesNotThrow(() => ingestRemoteEmail('not-json{', 'web', targets))
    await flush()
    assert.lengthOf(t.debug, 0)
    assert.lengthOf(t.dashboard, 0)
  })
})

// ---------------------------------------------------------------------------
// registerMailEventPublisher
// ---------------------------------------------------------------------------

test.group('email_bridge · registerMailEventPublisher', () => {
  test('publishes a payload for each mail event with the process tag', async ({ assert }) => {
    const handlers: Record<string, (data: unknown) => void> = {}
    const emitter = {
      on(event: string, handler: (data: unknown) => void) {
        handlers[event] = handler
      },
    }
    const published: Array<{ channel: string; message: string }> = []
    const redis = {
      publish: async (channel: string, message: string) => {
        published.push({ channel, message })
      },
    }

    registerMailEventPublisher(emitter, redis, 'tag-123', 'ch:emails')

    // Emit a mail:sent event with a nested message shape
    handlers['mail:sent']?.({
      message: { from: 'a@b.com', to: 'c@d.com', subject: 'Hi', html: '<p>x</p>' },
      mailerName: 'smtp',
    })
    await flush()

    assert.isAbove(published.length, 0)
    assert.equal(published[0].channel, 'ch:emails')
    const payload = JSON.parse(published[0].message)
    assert.equal(payload._t, 'tag-123')
    assert.equal(payload.status, 'sent')
  })
})
