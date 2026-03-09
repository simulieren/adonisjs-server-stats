// ---------------------------------------------------------------------------
// Field resolvers for snake_case / camelCase API response normalization
// ---------------------------------------------------------------------------
//
// The API may return fields in either snake_case (from raw DB queries) or
// camelCase (from AdonisJS serialization). These helpers eliminate the
// repeated `(row.camelCase || row.snake_case)` fallback pattern that
// appears across dashboard sections and debug panel tabs.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

/**
 * Resolve a field value from a row, trying multiple candidate key names.
 * Returns the first truthy value found, or the fallback.
 */
export function resolveField<T>(row: Row, ...keys: string[]): T | undefined {
  for (const key of keys) {
    const val = row[key]
    if (val !== undefined && val !== null) return val as T
  }
  return undefined
}

/**
 * Resolve a timestamp field. Tries `createdAt`, `created_at`, `timestamp`.
 */
export function resolveTimestamp(row: Row): string | number | undefined {
  return resolveField<string | number>(row, 'createdAt', 'created_at', 'timestamp')
}

/**
 * Resolve a timestamp for jobs. Tries `timestamp`, `createdAt`, `processedAt`, `created_at`.
 */
export function resolveJobTimestamp(row: Row): string | number | undefined {
  return resolveField<string | number>(row, 'timestamp', 'createdAt', 'processedAt', 'created_at')
}

/**
 * Resolve HTTP status code. Tries `statusCode`, `status_code`.
 */
export function resolveStatusCode(row: Row): number | undefined {
  return resolveField<number>(row, 'statusCode', 'status_code')
}

/**
 * Resolve request duration. Tries `total_duration`, `totalDuration`, `duration`.
 */
export function resolveDuration(row: Row): number {
  return resolveField<number>(row, 'total_duration', 'totalDuration', 'duration') ?? 0
}

/**
 * Resolve span count. Tries `span_count`, `spanCount`.
 */
export function resolveSpanCount(row: Row): number {
  return resolveField<number>(row, 'span_count', 'spanCount') ?? 0
}

/**
 * Resolve warning count. Tries `warning_count`, `warningCount`.
 */
export function resolveWarningCount(row: Row): number {
  return resolveField<number>(row, 'warning_count', 'warningCount') ?? 0
}

/**
 * Resolve email "from" address. Tries `from_addr`, `from`.
 */
export function resolveFromAddr(row: Row): string {
  return resolveField<string>(row, 'from_addr', 'from') ?? ''
}

/**
 * Resolve email "to" address. Tries `to_addr`, `to`.
 */
export function resolveToAddr(row: Row): string {
  return resolveField<string>(row, 'to_addr', 'to') ?? ''
}

/**
 * Resolve email CC address. Tries `cc`, `cc_addr`.
 */
export function resolveCcAddr(row: Row): string {
  return resolveField<string>(row, 'cc', 'cc_addr') ?? ''
}

/**
 * Resolve attachment count. Tries `attachment_count`, `attachmentCount`.
 */
export function resolveAttachmentCount(row: Row): number {
  return resolveField<number>(row, 'attachment_count', 'attachmentCount') ?? 0
}

/**
 * Resolve event name. Tries `event_name`, `eventName`, `event`.
 */
export function resolveEventName(row: Row): string {
  return resolveField<string>(row, 'event_name', 'eventName', 'event') ?? ''
}

/**
 * Resolve SQL method. Tries `method`, `sql_method`.
 */
export function resolveSqlMethod(row: Row): string {
  return resolveField<string>(row, 'method', 'sql_method') ?? ''
}

/**
 * Resolve normalized SQL text. Tries `sqlNormalized`, `normalizedSql`, `sql_normalized`, `sql`.
 */
export function resolveNormalizedSql(row: Row): string {
  return resolveField<string>(row, 'sqlNormalized', 'normalizedSql', 'sql_normalized', 'sql') ?? ''
}

/**
 * Resolve overview metric with snake_case fallback. Returns the camelCase
 * value if present, otherwise converts the snake_case raw value to a number.
 */
export function resolveMetric(
  metrics: Row,
  camelKey: string,
  snakeKey: string
): number {
  const camel = metrics[camelKey]
  if (camel !== undefined && camel !== null && camel !== 0) return Number(camel)
  return Number(metrics[snakeKey]) || 0
}
