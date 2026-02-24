import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class StatsMetric extends BaseModel {
  static connection = 'server_stats'
  static table = 'server_stats_metrics'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare bucket: string

  @column({ columnName: 'request_count' })
  declare requestCount: number

  @column({ columnName: 'avg_duration' })
  declare avgDuration: number

  @column({ columnName: 'p95_duration' })
  declare p95Duration: number

  @column({ columnName: 'error_count' })
  declare errorCount: number

  @column({ columnName: 'query_count' })
  declare queryCount: number

  @column({ columnName: 'avg_query_duration' })
  declare avgQueryDuration: number

  @column({ columnName: 'created_at' })
  declare createdAt: string
}
