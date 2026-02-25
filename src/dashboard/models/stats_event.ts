import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'

import StatsRequest from './stats_request.js'

import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class StatsEvent extends BaseModel {
  static connection = 'server_stats'
  static table = 'server_stats_events'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'request_id' })
  declare requestId: number | null

  @column({ columnName: 'event_name' })
  declare eventName: string

  @column({
    columnName: 'data',
    prepare: (value: any) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare data: any | null

  @column({ columnName: 'created_at' })
  declare createdAt: string

  @belongsTo(() => StatsRequest, { foreignKey: 'requestId' })
  declare request: BelongsTo<typeof StatsRequest>
}
