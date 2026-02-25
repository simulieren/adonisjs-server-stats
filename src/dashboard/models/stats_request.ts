import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'

import StatsEvent from './stats_event.js'
import StatsQuery from './stats_query.js'
import StatsTrace from './stats_trace.js'

import type { HasMany } from '@adonisjs/lucid/types/relations'

export default class StatsRequest extends BaseModel {
  static connection = 'server_stats'
  static table = 'server_stats_requests'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare method: string

  @column()
  declare url: string

  @column({ columnName: 'status_code' })
  declare statusCode: number

  @column()
  declare duration: number

  @column({ columnName: 'span_count' })
  declare spanCount: number

  @column({ columnName: 'warning_count' })
  declare warningCount: number

  @column({ columnName: 'created_at' })
  declare createdAt: string

  @hasMany(() => StatsQuery, { foreignKey: 'requestId' })
  declare queries: HasMany<typeof StatsQuery>

  @hasMany(() => StatsEvent, { foreignKey: 'requestId' })
  declare events: HasMany<typeof StatsEvent>

  @hasMany(() => StatsTrace, { foreignKey: 'requestId' })
  declare traces: HasMany<typeof StatsTrace>
}
