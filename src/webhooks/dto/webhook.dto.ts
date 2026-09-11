import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUrl } from 'class-validator'

import { DELIVERY_STATUSES, type DeliveryStatus, WEBHOOK_EVENTS } from '../webhook.entity.js'

const SUBSCRIBABLE = [...WEBHOOK_EVENTS, '*'] as const

export class CreateWebhookEndpointDto {
  @ApiProperty({ example: 'https://erp.example.com/hooks/dunlin' })
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  url: string

  @ApiProperty({
    enum: SUBSCRIBABLE,
    isArray: true,
    example: ['invoice.paid', 'dunning.notice_created'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SUBSCRIBABLE.length)
  @IsIn(SUBSCRIBABLE, { each: true })
  events: string[]
}

export class WebhookEndpointResponse {
  @ApiProperty() id: string
  @ApiProperty() url: string
  @ApiProperty({ type: [String] }) events: string[]
  @ApiProperty() active: boolean
  @ApiProperty() createdAt: string
}

export class CreatedWebhookEndpointResponse extends WebhookEndpointResponse {
  @ApiProperty({ description: 'HMAC secret for X-Dunlin-Signature. Shown once.' }) secret: string
}

export class WebhookDeliveryResponse {
  @ApiProperty() id: string
  @ApiProperty() endpointId: string
  @ApiProperty() eventId: string
  @ApiProperty() eventType: string
  @ApiProperty({ type: 'object', additionalProperties: true }) payload: Record<string, unknown>
  @ApiProperty({ enum: DELIVERY_STATUSES }) status: DeliveryStatus
  @ApiProperty() attempts: number
  @ApiProperty({ nullable: true }) lastStatusCode: number | null
  @ApiProperty({ nullable: true }) lastError: string | null
  @ApiProperty({ nullable: true }) deliveredAt: string | null
  @ApiProperty() createdAt: string
}
