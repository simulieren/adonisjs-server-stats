import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import StatsRequest from './stats_request.js'

export default class StatsTrace extends BaseModel {
  static connection = 'server_stats'
  static table = 'server_stats_traces'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'request_id' })
  declare requestId: number | null

  @column()
  declare method: string

  @column()
  declare url: string

  @column({ columnName: 'status_code' })
  declare statusCode: number

  @column({ columnName: 'total_duration' })
  declare totalDuration: number

  @column({ columnName: 'span_count' })
  declare spanCount: number

  @column({
    columnName: 'spans',
    prepare: (value: any) => JSON.stringify(value),
    consume: (value: string) => JSON.parse(value),
  })
  declare spans: any[]

  @column({
    columnName: 'warnings',
    prepare: (value: any) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare warnings: string[] | null

  @column({ columnName: 'created_at' })
  declare createdAt: string

  @belongsTo(() => StatsRequest, { foreignKey: 'requestId' })
  declare request: BelongsTo<typeof StatsRequest>
}
