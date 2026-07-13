/**
 * Pure helpers for hooking into pino's internal stream.
 */

/**
 * Find the `pino.stream` symbol on an object by description.
 * Pino uses a local Symbol('pino.stream'), not a global registry symbol.
 */
export function findPinoStreamSymbol(obj: object): symbol | undefined {
  return Object.getOwnPropertySymbols(obj).find((s) => s.description === 'pino.stream')
}

/** Marks a wrapped write fn so we never double-wrap and can restore the original. */
const WRAPPED_WRITE = Symbol('server-stats.wrappedWrite')

interface WrappedWrite {
  (chunk: string | Uint8Array, ...args: unknown[]): unknown
  [WRAPPED_WRITE]?: Function
}

/** Undo a previously-applied {@link wrapWriteMethod} on the same stream. */
export function unwrapWriteMethod(stream: { write: Function; [key: string]: unknown }): void {
  const current = stream.write as WrappedWrite
  const original = current?.[WRAPPED_WRITE]
  if (original) stream.write = original as typeof stream.write
}

/**
 * Wrap a stream's `write` method to intercept JSON log entries.
 * Calls `ingest` for each valid JSON entry that has a numeric `level`.
 * The original write is always called to preserve normal logging.
 *
 * Idempotent: if the stream's `write` is already wrapped by us, this is a
 * no-op so a hot-reload can't double-ingest. Restore via {@link unwrapWriteMethod}.
 */
export function wrapWriteMethod(
  stream: { write: Function; [key: string]: unknown },
  ingest: (entry: Record<string, unknown>) => void
): void {
  // Guard against re-wrapping an already-wrapped stream (hot-reload / restart).
  if ((stream.write as WrappedWrite)?.[WRAPPED_WRITE]) return
  const originalWrite = stream.write.bind(stream)
  const wrappedWrite: WrappedWrite = function wrappedWrite(
    chunk: string | Uint8Array,
    ...args: unknown[]
  ) {
    try {
      const str =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Uint8Array
            ? new TextDecoder().decode(chunk)
            : String(chunk)
      const entry = JSON.parse(str)
      if (entry && typeof entry.level === 'number') {
        ingest(entry)
      }
    } catch {
      // Not valid JSON — ignore (e.g. pino-pretty output)
    }
    return originalWrite(chunk, ...args)
  }
  // Store the pre-wrap write so cleanup can restore it exactly.
  wrappedWrite[WRAPPED_WRITE] = stream.write
  stream.write = wrappedWrite
}
