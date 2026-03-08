/**
 * Pure helpers for hooking into pino's internal stream.
 */

/**
 * Find the `pino.stream` symbol on an object by description.
 * Pino uses a local Symbol('pino.stream'), not a global registry symbol.
 */
export function findPinoStreamSymbol(obj: object): symbol | undefined {
  return Object.getOwnPropertySymbols(obj).find(
    (s) => s.description === 'pino.stream'
  )
}

/**
 * Wrap a stream's `write` method to intercept JSON log entries.
 * Calls `ingest` for each valid JSON entry that has a numeric `level`.
 * The original write is always called to preserve normal logging.
 */
export function wrapWriteMethod(
  stream: { write: Function; [key: string]: unknown },
  ingest: (entry: Record<string, unknown>) => void
): void {
  const originalWrite = stream.write.bind(stream)
  stream.write = function wrappedWrite(
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
}
