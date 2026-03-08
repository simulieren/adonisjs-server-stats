/**
 * Email bridge helpers for cross-process email capture via Redis pub/sub.
 */

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

/** Targets for ingesting remote emails. */
export interface EmailBridgeTargets {
  debugEmails: { ingest(record: Record<string, unknown>): void } | null
  dashboardStore: { recordEmail(record: Record<string, unknown>): void } | null
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
    targets.dashboardStore?.recordEmail({ id: 0, ...record })
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
  const processTag = `${process.pid}-${Date.now()}`
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
  const tag = `${process.pid}-${Date.now()}`
  registerMailEventPublisher(emitter, redis, tag, channel)
  log.info('email bridge publisher active (queue worker → Redis)')
}
