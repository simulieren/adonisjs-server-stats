import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import StatsRequest from './stats_request.js'

export default class StatsQuery extends BaseModel {
  static connection = 'server_stats'
  static table = 'server_stats_queries'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'request_id' })
  declare requestId: number | null

  @column({ columnName: 'sql_text' })
  declare sqlText: string

  @column({ columnName: 'sql_normalized' })
  declare sqlNormalized: string

  @column({
    columnName: 'bindings',
    prepare: (value: any) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare bindings: any[] | null

  @column()
  declare duration: number

  @column()
  declare method: string | null

  @column()
  declare model: string | null

  @column()
  declare connection: string | null

  @column({ columnName: 'in_transaction' })
  declare inTransaction: number

  @column({ columnName: 'created_at' })
  declare createdAt: string

  @belongsTo(() => StatsRequest, { foreignKey: 'requestId' })
  declare request: BelongsTo<typeof StatsRequest>
}
