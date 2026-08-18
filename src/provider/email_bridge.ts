/**
 * Email bridge helpers for cross-process email capture via Redis pub/sub.
 */

import { randomUUID } from 'node:crypto'

import { log } from '../utils/logger.js'
import { buildEmailPayload, MAIL_STATUS_MAP } from './email_helpers.js'

/** Minimal emitter interface. */
interface BridgeEmitter {
  on(event: string, handler: (...args: unknown[]) => void): void
}

/** Minimal Redis publisher interface. */
interface RedisPublisher {
  publish(channel: string, message: string): Promise<unknown>
}

/** Minimal Redis subscriber interface. */
interface RedisSubscriber extends RedisPublisher {
  subscribe(channel: string, handler: (message: string) => void): unknown
}

/** Sink that persists an ingested email (the SQLite dashboard store). */
interface DashboardEmailSink {
  recordEmail(record: Record<string, unknown>): void
}

/** Targets for ingesting remote emails. */
export interface EmailBridgeTargets {
  debugEmails: { ingest(record: Record<string, unknown>): void } | null
  /**
   * The persistent dashboard store, or a (possibly async) getter for it.
   *
   * A getter is used because the bridge subscribes during early boot —
   * before the SQLite dashboard store exists — yet remote emails arrive
   * later, by which time the store is available. Resolving lazily lets
   * cross-process (queue-worker) emails land in SQLite, where the
   * dashboard/debug APIs read from when persistence is enabled.
   */
  dashboardStore:
    | DashboardEmailSink
    | (() => DashboardEmailSink | null | Promise<DashboardEmailSink | null>)
    | null
}

/** Resolve the dashboard sink whether it's a direct object, a getter, or null. */
async function resolveDashboardSink(
  store: EmailBridgeTargets['dashboardStore']
): Promise<DashboardEmailSink | null> {
  if (!store) return null
  if (typeof store === 'function') {
    try {
      return (await store()) ?? null
    } catch {
      return null
    }
  }
  return store
}

/** Options for subscribing to the email bridge. */
interface SubscribeOptions {
  redis: RedisSubscriber
  channel: string
  processTag: string
  targets: EmailBridgeTargets
}

/**
 * Ingest a remote email message from Redis pub/sub.
 * Skips messages from the same process.
 */
export function ingestRemoteEmail(
  message: string,
  processTag: string,
  targets: EmailBridgeTargets
): void {
  try {
    const parsed = JSON.parse(message)
    if (parsed._t === processTag) return
    const { _t: _, ...fields } = parsed
    const record = {
      ...fields,
      html: fields.html || null,
      text: fields.text || null,
    }
    targets.debugEmails?.ingest(record)
    // Persist to SQLite too (where the APIs read from). The store may be
    // resolved lazily, so fire-and-forget without blocking ingestion.
    void resolveDashboardSink(targets.dashboardStore).then((sink) => {
      sink?.recordEmail({ id: 0, ...record })
    })
  } catch {
    // Ignore malformed messages
  }
}

/**
 * Register mail event listeners that publish to Redis.
 */
export function registerMailEventPublisher(
  emitter: BridgeEmitter,
  redis: RedisPublisher,
  processTag: string,
  channel: string
): void {
  for (const [event, status] of MAIL_STATUS_MAP) {
    emitter.on(event, (data: unknown) => {
      try {
        const payload = JSON.stringify(buildEmailPayload(data, status, processTag))
        redis.publish(channel, payload).catch(() => {})
      } catch {
        // Silently ignore serialization errors
      }
    })
  }
}

/**
 * Subscribe to Redis channel for cross-process email capture.
 */
async function subscribeToEmailBridge(opts: SubscribeOptions): Promise<unknown> {
  try {
    await opts.redis.subscribe(opts.channel, (message: string) => {
      ingestRemoteEmail(message, opts.processTag, opts.targets)
    })
    log.info('email bridge active (cross-process capture via Redis)')
    return opts.redis
  } catch {
    return null
  }
}

/**
 * Full email bridge setup: publish local events + subscribe to remote ones.
 * Returns the Redis instance (for cleanup) or null.
 */
export async function setupFullEmailBridge(
  emitter: BridgeEmitter,
  redis: RedisSubscriber,
  channel: string,
  targets: EmailBridgeTargets
): Promise<unknown> {
  // Append a random UUID: in PID-recycling environments (e.g. every container is
  // pid 1) `pid-timestamp` can collide across processes, causing a peer's emails
  // to be filtered out as self-sent. The UUID makes the tag unique per instance.
  const processTag = `${process.pid}-${Date.now()}-${randomUUID()}`
  registerMailEventPublisher(emitter, redis, processTag, channel)
  return subscribeToEmailBridge({
    redis,
    channel,
    processTag,
    targets,
  })
}

/**
 * Lightweight publisher-only email bridge (for non-web environments).
 */
export function setupPublisherOnlyBridge(
  emitter: BridgeEmitter,
  redis: RedisPublisher,
  channel: string
): void {
  const tag = `${process.pid}-${Date.now()}-${randomUUID()}`
  registerMailEventPublisher(emitter, redis, tag, channel)
  log.info('email bridge publisher active (queue worker → Redis)')
}
