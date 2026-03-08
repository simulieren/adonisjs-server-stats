// ---------------------------------------------------------------------------
// Helpers extracted from transmit-adapter.ts to reduce function length
// ---------------------------------------------------------------------------

/**
 * Build the options object for the Transmit constructor.
 *
 * When an authToken is provided, adds `beforeSubscribe` and
 * `beforeUnsubscribe` hooks that attach a Bearer token header.
 */
export function buildTransmitOptions(
  baseUrl: string,
  authToken?: string
): Record<string, unknown> {
  const resolvedBaseUrl =
    baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')

  if (!authToken) {
    return { baseUrl: resolvedBaseUrl }
  }

  const authHeader = { headers: { Authorization: `Bearer ${authToken}` } }
  return {
    baseUrl: resolvedBaseUrl,
    beforeSubscribe(_request: RequestInit) {
      return authHeader
    },
    beforeUnsubscribe(_request: RequestInit) {
      return authHeader
    },
  }
}
