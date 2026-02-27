import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class StatsSavedFilter extends BaseModel {
  static connection = 'server_stats'
  static table = 'server_stats_saved_filters'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare section: string

  @column({
    columnName: 'filter_config',
    prepare: (value: unknown) => JSON.stringify(value),
    consume: (value: string) => JSON.parse(value),
  })
  declare filterConfig: Record<string, unknown>

  @column({ columnName: 'created_at' })
  declare createdAt: string
}
