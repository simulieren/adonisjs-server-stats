// ---------------------------------------------------------------------------
// Framework-agnostic controller for SSE + polling server stats
// ---------------------------------------------------------------------------
//
// Encapsulates the entire SSE subscription + polling fallback state machine
// that was previously duplicated in both React and Vue hooks.
//
// Algorithm:
//   1. Try SSE via subscribeToChannel()
//   2. Always do an initial poll
//   3. If SSE fails, start polling; if SSE connects, stop polling
//   4. 3-second fallback timer to start polling if SSE hasn't connected
//   5. Stale detection via STALE_MS interval check
//   6. Cleanup on stop()
// ---------------------------------------------------------------------------

import { ApiClient, UnauthorizedError } from './api-client.js'
import { createHistoryBuffer } from './history-buffer.js'
import { STALE_MS } from './metrics.js'
import { subscribeToChannel } from './transmit-adapter.js'

import type { HistoryBuffer } from './history-buffer.js'
import type { ServerStats } from './types.js'

/**
 * Connection mode reflecting the current transport.
 */
export type ConnectionMode = 'live' | 'polling' | 'disconnected'

/**
 * Configuration for {@link ServerStatsController}.
 */
export interface ServerStatsControllerConfig {
  /** Base URL for API calls. Defaults to `''` (same origin). */
  baseUrl?: string
  /** Stats endpoint path. Defaults to `'/admin/api/server-stats'`. */
  endpoint?: string
  /** Transmit channel name. Defaults to `'admin/server-stats'`. */
  channelName?: string
  /** Optional auth token for Bearer auth. */
  authToken?: string
  /** Polling interval fallback in ms. Defaults to `3000`. */
  pollInterval?: number

  // -- Callbacks (framework layer bridges these to reactive state) ----------

  /** Called with every new stats snapshot. */
  onStatsUpdate?: (stats: ServerStats) => void
  /** Called when the SSE connection state changes. */
  onConnectionChange?: (connected: boolean) => void
  /** Called when stale detection changes. */
  onStaleChange?: (stale: boolean) => void
  /** Called when an error occurs. */
  onError?: (error: Error | null) => void
  /** Called when the unauthorized state changes. */
  onUnauthorizedChange?: (unauthorized: boolean) => void
  /** Called when the history buffer changes (new data pushed). */
  onHistoryChange?: (history: Record<string, number[]>) => void
  /** Called when the SSE active state changes (separate from isConnected). */
  onSseActiveChange?: (active: boolean) => void
  /** Called when the poll timer state changes (running or not). */
  onPollActiveChange?: (active: boolean) => void
}

/**
 * Framework-agnostic controller that owns the entire SSE subscription +
 * polling fallback lifecycle for server stats.
 *
 * React and Vue hooks create a thin wrapper around this class, bridging
 * the callbacks to their respective reactivity primitives.
 */
export class ServerStatsController {
  // -- Configuration --------------------------------------------------------
  private readonly baseUrl: string
  private readonly endpoint: string
  private readonly channelName: string
  private readonly authToken: string | undefined
  private readonly pollInterval: number

  // -- Callbacks ------------------------------------------------------------
  private readonly onStatsUpdate: ServerStatsControllerConfig['onStatsUpdate']
  private readonly onConnectionChange: ServerStatsControllerConfig['onConnectionChange']
  private readonly onStaleChange: ServerStatsControllerConfig['onStaleChange']
  private readonly onError: ServerStatsControllerConfig['onError']
  private readonly onUnauthorizedChange: ServerStatsControllerConfig['onUnauthorizedChange']
  private readonly onHistoryChange: ServerStatsControllerConfig['onHistoryChange']
  private readonly onSseActiveChange: ServerStatsControllerConfig['onSseActiveChange']
  private readonly onPollActiveChange: ServerStatsControllerConfig['onPollActiveChange']

  // -- Internal state -------------------------------------------------------
  private readonly historyBuffer: HistoryBuffer
  private client: ApiClient | null = null
  private sseHandle: { unsubscribe: () => void } | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private staleTimer: ReturnType<typeof setInterval> | null = null
  private lastSuccess = 0
  private unauthorized = false
  private sseActive = false
  private isConnected = false
  private isStale = false

  constructor(config: ServerStatsControllerConfig = {}) {
    this.baseUrl = config.baseUrl ?? ''
    this.endpoint = config.endpoint ?? '/admin/api/server-stats'
    this.channelName = config.channelName ?? 'admin/server-stats'
    this.authToken = config.authToken
    this.pollInterval = config.pollInterval ?? 3000

    this.onStatsUpdate = config.onStatsUpdate
    this.onConnectionChange = config.onConnectionChange
    this.onStaleChange = config.onStaleChange
    this.onError = config.onError
    this.onUnauthorizedChange = config.onUnauthorizedChange
    this.onHistoryChange = config.onHistoryChange
    this.onSseActiveChange = config.onSseActiveChange
    this.onPollActiveChange = config.onPollActiveChange

    this.historyBuffer = createHistoryBuffer()
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Start the SSE subscription + polling lifecycle.
   *
   * Safe to call multiple times (subsequent calls are no-ops).
   */
  start(): void {
    if (this.unauthorized) return

    let usePolling = false

    try {
      const sub = subscribeToChannel({
        baseUrl: this.baseUrl,
        channelName: this.channelName,
        authToken: this.authToken,
        onMessage: (data) => {
          if (data && typeof data === 'object' && 'timestamp' in data) {
            this.processStats(data as ServerStats)
          }
        },
        onConnect: () => {
          this.setSseActive(true)
          this.setConnected(true)
          // Stop polling -- SSE is delivering data
          this.stopPolling()
        },
        onDisconnect: () => {
          this.setSseActive(false)
          this.setConnected(false)
          // Fall back to polling
          if (!this.pollTimer && !this.unauthorized) {
            this.startPollInterval()
          }
        },
        onError: () => {
          // SSE failed, fall back to polling
          usePolling = true
        },
      })

      this.sseHandle = sub
    } catch {
      usePolling = true
    }

    // Always do an initial poll to get data fast
    this.poll()

    // Start polling as fallback (will be stopped if SSE connects)
    if (usePolling || !this.sseHandle) {
      this.startPollInterval()
    } else {
      // Give SSE 3 seconds to connect, then start polling as backup
      const fallbackTimer = setTimeout(() => {
        if (!this.isConnected && !this.pollTimer) {
          this.startPollInterval()
        }
      }, 3000)

      // Store the fallback timer for cleanup
      const originalUnsubscribe = this.sseHandle?.unsubscribe
      if (this.sseHandle) {
        this.sseHandle.unsubscribe = () => {
          clearTimeout(fallbackTimer)
          originalUnsubscribe?.()
        }
      }
    }

    // Stale detection
    this.staleTimer = setInterval(() => {
      if (this.lastSuccess > 0 && Date.now() - this.lastSuccess > STALE_MS) {
        this.setStale(true)
      }
    }, 2000)
  }

  /**
   * Stop all timers and subscriptions. Call on unmount.
   */
  stop(): void {
    this.sseHandle?.unsubscribe()
    this.sseHandle = null
    this.stopPolling()
    if (this.staleTimer) {
      clearInterval(this.staleTimer)
      this.staleTimer = null
    }
  }

  /**
   * Get the history array for a single metric key.
   */
  getHistory(key: string): number[] {
    return this.historyBuffer.get(key)
  }

  /**
   * Get the entire history map (all keys).
   */
  getAllHistory(): Record<string, number[]> {
    return this.historyBuffer.getAll()
  }

  /**
   * Get the current connection mode.
   */
  getConnectionMode(): ConnectionMode {
    if (this.unauthorized) return 'disconnected'
    if (this.sseActive) return 'live'
    if (this.pollTimer) return 'polling'
    return 'disconnected'
  }

  // -- Internal helpers -----------------------------------------------------

  /** Process incoming stats data from either SSE or polling. */
  private processStats(data: ServerStats): void {
    this.onStatsUpdate?.(data)
    this.onError?.(null)
    this.lastSuccess = Date.now()
    this.setStale(false)

    this.historyBuffer.push(data)
    this.onHistoryChange?.(this.historyBuffer.getAll())
  }

  /** Poll the HTTP endpoint once. */
  private async poll(): Promise<void> {
    if (this.unauthorized) return
    if (!this.client) {
      this.client = new ApiClient({ baseUrl: this.baseUrl, authToken: this.authToken })
    }

    try {
      const data = await this.client.get<ServerStats>(this.endpoint)
      this.processStats(data)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.unauthorized = true
        this.onUnauthorizedChange?.(true)
        this.onError?.(err)
        this.stopPolling()
      }
      // Network errors just mean stale data
    }
  }

  /** Start the poll interval timer. */
  private startPollInterval(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval)
    this.onPollActiveChange?.(true)
  }

  /** Stop the poll interval timer. */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
      this.onPollActiveChange?.(false)
    }
  }

  /** Update SSE active state and notify. */
  private setSseActive(active: boolean): void {
    if (this.sseActive !== active) {
      this.sseActive = active
      this.onSseActiveChange?.(active)
    }
  }

  /** Update connected state and notify. */
  private setConnected(connected: boolean): void {
    if (this.isConnected !== connected) {
      this.isConnected = connected
      this.onConnectionChange?.(connected)
    }
  }

  /** Update stale state and notify. */
  private setStale(stale: boolean): void {
    if (this.isStale !== stale) {
      this.isStale = stale
      this.onStaleChange?.(stale)
    }
  }
}
