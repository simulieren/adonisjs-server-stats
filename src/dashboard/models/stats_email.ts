import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class StatsEmail extends BaseModel {
  static connection = 'server_stats'
  static table = 'server_stats_emails'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'from_addr' })
  declare fromAddr: string

  @column({ columnName: 'to_addr' })
  declare toAddr: string

  @column()
  declare cc: string | null

  @column()
  declare bcc: string | null

  @column()
  declare subject: string

  @column()
  declare html: string | null

  @column({ columnName: 'text_body' })
  declare textBody: string | null

  @column()
  declare mailer: string

  @column()
  declare status: string

  @column({ columnName: 'message_id' })
  declare messageId: string | null

  @column({ columnName: 'attachment_count' })
  declare attachmentCount: number

  @column({ columnName: 'created_at' })
  declare createdAt: string
}
