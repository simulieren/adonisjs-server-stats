import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class StatsLog extends BaseModel {
  static connection = 'server_stats'
  static table = 'server_stats_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare level: string

  @column()
  declare message: string

  @column({ columnName: 'request_id' })
  declare requestId: string | null

  @column({
    columnName: 'data',
    prepare: (value: unknown) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare data: any | null

  @column({ columnName: 'created_at' })
  declare createdAt: string
}
