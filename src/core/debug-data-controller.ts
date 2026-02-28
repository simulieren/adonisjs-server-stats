// ---------------------------------------------------------------------------
// Framework-agnostic debug data controller
// ---------------------------------------------------------------------------
//
// Extracts the shared fetch lifecycle, auto-refresh timer, and fetchOnce
// cache from the React `useDebugData` hook (source of truth) into a
// framework-agnostic class.  Both React and Vue thin wrappers delegate to
// this controller so the logic is maintained in a single place.
// ---------------------------------------------------------------------------

import { ApiClient, UnauthorizedError } from './api-client.js'
import { getDebugTabPath } from './routes.js'
import { DEBUG_REFRESH_MS } from './constants.js'

/**
 * Callback configuration for {@link DebugDataController}.
 *
 * The controller itself holds no UI state — it communicates every
 * state change through these callbacks so the framework wrapper
 * (React hook / Vue composable) can update its own reactive state.
 */
export interface DebugDataControllerCallbacks<T = unknown> {
  /** Called with the parsed JSON payload after a successful fetch. */
  onData: (data: T) => void
  /** Called whenever the loading flag changes. */
  onLoading: (loading: boolean) => void
  /** Called with an `Error` (or `null` to clear) on fetch failure. */
  onError: (error: Error | null) => void
  /** Called when the server responds with 401/403. */
  onUnauthorized: (error: UnauthorizedError) => void
}

/**
 * Configuration for {@link DebugDataController}.
 */
export interface DebugDataControllerConfig<T = unknown> extends DebugDataControllerCallbacks<T> {
  /** Base URL for API requests (e.g. `''` for same-origin). */
  baseUrl: string
  /** Debug API endpoint base path (default `'/admin/api/debug'`). */
  endpoint?: string
  /** Optional Bearer token. */
  authToken?: string
  /** Auto-refresh interval in ms (default {@link DEBUG_REFRESH_MS}). */
  refreshInterval?: number
}

/**
 * Framework-agnostic controller that owns the debug-tab data
 * fetching lifecycle: initial fetch, auto-refresh timer, fetchOnce
 * cache, and `UnauthorizedError` handling.
 *
 * Designed to be instantiated once per component mount and driven
 * by a thin framework wrapper that bridges the callbacks to the
 * framework's reactive primitives.
 */
export class DebugDataController<T = unknown> {
  private client: ApiClient
  private endpoint: string
  private refreshInterval: number
  private callbacks: DebugDataControllerCallbacks<T>

  private timer: ReturnType<typeof setInterval> | null = null
  private currentTab: string | null = null
  private fetchOnceCache: Record<string, unknown> = {}

  constructor(config: DebugDataControllerConfig<T>) {
    this.client = new ApiClient({
      baseUrl: config.baseUrl,
      authToken: config.authToken,
    })
    this.endpoint = config.endpoint ?? '/admin/api/debug'
    this.refreshInterval = config.refreshInterval ?? DEBUG_REFRESH_MS
    this.callbacks = {
      onData: config.onData,
      onLoading: config.onLoading,
      onError: config.onError,
      onUnauthorized: config.onUnauthorized,
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Begin fetching data for `tab` and start the auto-refresh timer.
   *
   * If a timer is already running it will be stopped first.
   */
  start(tab: string): void {
    this.stop()
    this.currentTab = tab
    this.callbacks.onLoading(true)
    this.callbacks.onError(null)
    this.fetchData()
    this.timer = setInterval(() => this.fetchData(), this.refreshInterval)
  }

  /**
   * Stop the auto-refresh timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Switch to a different tab.
   *
   * Stops the current timer, resets loading/error state, and starts
   * fetching for the new tab.
   */
  switchTab(tab: string): void {
    this.start(tab)
  }

  /**
   * Force an immediate re-fetch of the current tab (ignoring the
   * fetchOnce cache).
   */
  refresh(): void {
    if (this.currentTab) {
      this.fetchData()
    }
  }

  /**
   * Fetch a custom pane endpoint.  Optionally honours the fetchOnce
   * cache so a pane that has already been loaded is not re-requested.
   */
  async fetchCustomPane(panePath: string, fetchOnce: boolean = false): Promise<void> {
    if (fetchOnce && this.fetchOnceCache[panePath] !== undefined) {
      this.callbacks.onData(this.fetchOnceCache[panePath] as T)
      this.callbacks.onLoading(false)
      return
    }

    this.callbacks.onLoading(true)
    try {
      const result = await this.client.fetch<T>(panePath)
      this.callbacks.onData(result)
      this.callbacks.onError(null)
      if (fetchOnce) {
        this.fetchOnceCache[panePath] = result
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.callbacks.onUnauthorized(err)
        return
      }
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.callbacks.onLoading(false)
    }
  }

  /**
   * Store a value in the fetchOnce cache for a given tab name.
   * Subsequent `start()` / `switchTab()` calls for this tab will
   * serve the cached value instead of hitting the network.
   */
  cacheForTab(tabName: string, data: unknown): void {
    this.fetchOnceCache[tabName] = data
  }

  /**
   * Clear all cached fetchOnce data.
   */
  clearCache(): void {
    this.fetchOnceCache = {}
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async fetchData(): Promise<void> {
    const tab = this.currentTab
    if (!tab) return

    // Serve from cache if available (fetchOnce pattern)
    if (this.fetchOnceCache[tab] !== undefined) {
      this.callbacks.onData(this.fetchOnceCache[tab] as T)
      this.callbacks.onLoading(false)
      return
    }

    try {
      const path = `${this.endpoint}${getDebugTabPath(tab)}`
      const result = await this.client.fetch<T>(path)
      this.callbacks.onData(result)
      this.callbacks.onError(null)
      this.callbacks.onLoading(false)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        this.callbacks.onError(err)
        this.callbacks.onLoading(false)
        this.stop()
        this.callbacks.onUnauthorized(err)
        return
      }
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)))
      this.callbacks.onLoading(false)
    }
  }
}
