import { Controller, Get, Query } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'

import { RequireRole } from '../auth/decorators.js'
import { MailService } from './mail.service.js'
import { OUTBOX_STATUSES, type OutboxMessage, type OutboxStatus } from './outbox.entity.js'

export class OutboxMessageResponse {
  @ApiProperty() id: string
  @ApiProperty() to: string
  @ApiProperty() subject: string
  @ApiProperty() template: string
  @ApiProperty({ nullable: true }) subjectId: string | null
  @ApiProperty({ enum: OUTBOX_STATUSES }) status: OutboxStatus
  @ApiProperty() attempts: number
  @ApiProperty({ nullable: true }) lastError: string | null
  @ApiProperty({ nullable: true }) sentAt: string | null
  @ApiProperty() createdAt: string
}

export function toOutboxResponse(message: OutboxMessage): OutboxMessageResponse {
  return {
    id: message.id,
    to: message.toEmail,
    subject: message.subject,
    template: message.template,
    subjectId: message.subjectId,
    status: message.status,
    attempts: message.attempts,
    lastError: message.lastError,
    sentAt: message.sentAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}

@ApiTags('Mail')
@ApiBearerAuth('api-key')
@Controller('v1/mail/outbox')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get()
  @RequireRole('accountant')
  @ApiOperation({ summary: 'The last hundred messages, newest first' })
  @ApiQuery({ name: 'status', enum: OUTBOX_STATUSES, required: false })
  @ApiOkResponse({ type: [OutboxMessageResponse] })
  async list(@Query('status') status?: OutboxStatus): Promise<OutboxMessageResponse[]> {
    const valid = status && OUTBOX_STATUSES.includes(status) ? status : undefined
    return (await this.mail.list(valid)).map(toOutboxResponse)
  }
}
