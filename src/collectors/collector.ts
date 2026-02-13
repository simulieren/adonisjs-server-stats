export interface MetricCollector {
  name: string
  start?(): void | Promise<void>
  stop?(): void | Promise<void>
  collect(): Record<string, string | number | boolean> | Promise<Record<string, string | number | boolean>>
}
