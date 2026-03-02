// ---------------------------------------------------------------------------
// Wrapper for @adonisjs/transmit-client SSE subscriptions
// ---------------------------------------------------------------------------

/**
 * Configuration for creating a Transmit SSE subscription.
 */
export interface TransmitSubscriptionConfig {
  /** Base URL for the Transmit endpoint (same as the API base URL). */
  baseUrl: string
  /** Transmit channel name (e.g. `'admin/server-stats'`). */
  channelName: string
  /** Callback invoked with each incoming message payload. */
  onMessage: (data: unknown) => void
  /** Callback invoked when an error occurs. */
  onError?: (error: unknown) => void
  /** Optional Bearer token for auth. */
  authToken?: string
}

/**
 * Handle returned by {@link createTransmitSubscription}.
 */
export interface TransmitSubscriptionHandle {
  /** Subscribe to the channel and start receiving messages. */
  subscribe: () => Promise<void>
  /** Unsubscribe and clean up. */
  unsubscribe: () => Promise<void>
}

/**
 * Create a Transmit SSE subscription.
 *
 * Dynamically imports `@adonisjs/transmit-client` so the dependency
 * remains optional. If the import fails (package not installed),
 * returns a no-op handle and calls `onError` with the import error.
 *
 * @param config - Subscription configuration.
 * @returns A handle with `subscribe()` and `unsubscribe()` methods.
 */
/** Minimal interface for the Transmit constructor. */
interface TransmitConstructor {
  new (options: Record<string, unknown>): TransmitClient
}

/** Minimal interface for a Transmit client instance. */
interface TransmitClient {
  subscription(channel: string): TransmitSubscription
}

/** Minimal interface for a Transmit channel subscription. */
interface TransmitSubscription {
  onMessage(callback: (data: unknown) => void): void
  create(): Promise<void>
  delete(): Promise<void>
}

/** Resolve the Transmit constructor from window global or dynamic import. */
async function resolveTransmitClass(): Promise<TransmitConstructor | null> {
  // 1. Check for window.Transmit (injected by the Edge template inline script)
  if (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).Transmit &&
    typeof (window as unknown as Record<string, unknown>).Transmit === 'function'
  ) {
    return (window as unknown as Record<string, TransmitConstructor>).Transmit
  }

  // 2. Fall back to dynamic import (works in bundled environments)
  try {
    // @ts-expect-error -- @adonisjs/transmit-client is an optional peer dependency
    const mod = await import('@adonisjs/transmit-client')
    return mod.Transmit ?? mod.default ?? null
  } catch {
    return null
  }
}

export function createTransmitSubscription(
  config: TransmitSubscriptionConfig
): TransmitSubscriptionHandle {
  let transmit: TransmitClient | null = null
  let subscription: TransmitSubscription | null = null
  let disposed = false

  const subscribe = async (): Promise<void> => {
    try {
      const Transmit = await resolveTransmitClass()

      if (!Transmit) {
        throw new Error(
          'Transmit client not available (neither window.Transmit nor @adonisjs/transmit-client)'
        )
      }

      if (disposed) return

      transmit = new Transmit({
        baseUrl: config.baseUrl || window.location.origin,
        ...(config.authToken
          ? {
              beforeSubscribe(_request: RequestInit) {
                return {
                  headers: {
                    Authorization: `Bearer ${config.authToken}`,
                  },
                }
              },
              beforeUnsubscribe(_request: RequestInit) {
                return {
                  headers: {
                    Authorization: `Bearer ${config.authToken}`,
                  },
                }
              },
            }
          : {}),
      })

      subscription = transmit.subscription(config.channelName)

      subscription.onMessage((data: unknown) => {
        if (!disposed) {
          config.onMessage(data)
        }
      })

      await subscription.create()
    } catch (error: unknown) {
      if (config.onError) {
        config.onError(error)
      }
    }
  }

  const unsubscribe = async (): Promise<void> => {
    disposed = true
    try {
      if (subscription) {
        await subscription.delete()
        subscription = null
      }
      if (transmit) {
        transmit = null
      }
    } catch {
      // Silently ignore cleanup errors
    }
  }

  return { subscribe, unsubscribe }
}

// ---------------------------------------------------------------------------
// Convenience wrapper for React / Vue hooks
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link subscribeToChannel}.
 * Extends the base config with connect / disconnect lifecycle callbacks.
 */
export interface ChannelSubscriptionConfig {
  /** Base URL for the Transmit endpoint. */
  baseUrl: string
  /** Transmit channel name. */
  channelName: string
  /** Optional Bearer token for auth. */
  authToken?: string
  /** Callback invoked with each incoming message payload. */
  onMessage: (data: unknown) => void
  /** Callback invoked when an error occurs. */
  onError?: (error: unknown) => void
  /** Callback invoked once the subscription is established. */
  onConnect?: () => void
  /** Callback invoked when the subscription is lost. */
  onDisconnect?: () => void
}

/**
 * Subscribe to a Transmit channel and immediately start receiving messages.
 *
 * This is a convenience wrapper around {@link createTransmitSubscription} that
 * auto-calls `subscribe()`, reports connect / disconnect via callbacks, and
 * returns a simple `{ unsubscribe }` handle.
 *
 * @param config - Channel subscription configuration.
 * @returns A handle with an `unsubscribe()` method.
 */
export function subscribeToChannel(config: ChannelSubscriptionConfig): { unsubscribe: () => void } {
  let didError = false

  const handle = createTransmitSubscription({
    baseUrl: config.baseUrl,
    channelName: config.channelName,
    authToken: config.authToken,
    onMessage: config.onMessage,
    onError: (err) => {
      didError = true
      config.onError?.(err)
      config.onDisconnect?.()
    },
  })

  // Auto-subscribe and fire lifecycle callbacks
  handle
    .subscribe()
    .then(() => {
      // Only fire onConnect if the subscription succeeded without errors
      if (!didError) {
        config.onConnect?.()
      }
    })
    .catch((err) => {
      config.onError?.(err)
      config.onDisconnect?.()
    })

  return {
    unsubscribe: () => {
      handle.unsubscribe().catch(() => {})
    },
  }
}
