// ---------------------------------------------------------------------------
// HTTP client with auth auto-detect
// ---------------------------------------------------------------------------

/**
 * Error thrown when the server responds with 401 or 403.
 */
export class UnauthorizedError extends Error {
  public readonly status: number

  constructor(status: number = 403) {
    super(`Unauthorized (HTTP ${status})`)
    this.name = 'UnauthorizedError'
    this.status = status
  }
}

/**
 * Error thrown for non-OK responses that are not auth-related.
 */
export class ApiError extends Error {
  public readonly status: number
  public readonly body: string

  constructor(status: number, body: string) {
    super(`API error (HTTP ${status})`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * Configuration for {@link ApiClient}.
 */
export interface ApiClientConfig {
  /** Base URL for all requests (e.g. `''` for same origin, or `'https://api.example.com'`). */
  baseUrl: string
  /** Optional Bearer token. When provided, `credentials` is set to `'omit'`. */
  authToken?: string
}

/**
 * Lightweight HTTP client for the server-stats API endpoints.
 *
 * Auth strategy:
 * - If `authToken` is provided, sends `Authorization: Bearer <token>`
 *   with `credentials: 'omit'` (no cookies).
 * - Otherwise uses `credentials: 'include'` for cookie-based auth.
 *
 * All non-OK responses are thrown as typed errors:
 * - 401 / 403 -> {@link UnauthorizedError}
 * - Other non-OK -> {@link ApiError}
 */
export class ApiClient {
  private baseUrl: string
  private authToken: string | undefined

  constructor(config: ApiClientConfig) {
    // Strip trailing slashes from baseUrl for clean concatenation
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.authToken = config.authToken
  }

  /**
   * Perform a JSON fetch against the configured base URL.
   *
   * @param path - URL path appended to `baseUrl` (must start with `/`).
   * @param init - Optional `RequestInit` overrides. Headers are merged.
   * @returns Parsed JSON response body typed as `T`.
   */
  async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
    }

    const mergedHeaders: Record<string, string> = {
      ...headers,
      ...((init?.headers as Record<string, string>) ?? {}),
    }

    const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: mergedHeaders,
      credentials: this.authToken ? 'omit' : 'include',
    })

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedError(response.status)
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new ApiError(response.status, body)
    }

    return response.json() as Promise<T>
  }

  /**
   * Perform a GET request.
   *
   * @param path   - URL path appended to `baseUrl`.
   * @param query  - Optional query string (without leading `?`).
   * @returns Parsed JSON response body typed as `T`.
   */
  async get<T>(path: string, query?: string): Promise<T> {
    const url = query ? `${path}?${query}` : path
    return this.fetch<T>(url)
  }

  /**
   * Perform a POST request with an optional JSON body.
   *
   * @param path - URL path appended to `baseUrl`.
   * @param body - Optional request body (will be JSON-serialized).
   * @returns Parsed JSON response body typed as `T`.
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method: 'POST',
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          }
        : {}),
    }
    return this.fetch<T>(path, init)
  }

  /**
   * Perform a DELETE request.
   *
   * @param path - URL path appended to `baseUrl`.
   * @returns Parsed JSON response body typed as `T`.
   */
  async delete<T>(path: string): Promise<T> {
    return this.fetch<T>(path, { method: 'DELETE' })
  }
}
