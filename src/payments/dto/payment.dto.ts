import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'

import { MAX_MINOR } from '../../common/money.js'
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  PAYMENT_SOURCES,
  type PaymentSource,
} from '../payment.entity.js'

export class RecordPaymentDto {
  @ApiProperty({ example: 12_500, description: 'Minor units; at most the open balance' })
  @IsInt()
  @Min(1)
  @Max(MAX_MINOR)
  amountMinor: number

  @ApiProperty({ example: '2026-09-15' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) receivedOn: string

  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method: PaymentMethod

  @ApiPropertyOptional({ example: 'Bank ref 8812' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string
}

export class PaymentResponse {
  @ApiProperty() id: string
  @ApiProperty() invoiceId: string
  @ApiProperty() amountMinor: number
  @ApiProperty() currency: string
  @ApiProperty() receivedOn: string
  @ApiProperty({ enum: PAYMENT_METHODS }) method: PaymentMethod
  @ApiProperty({ nullable: true }) reference: string | null
  @ApiProperty({ enum: PAYMENT_SOURCES }) source: PaymentSource
  @ApiProperty({ nullable: true }) bankImportLineId: string | null
  @ApiProperty() createdAt: string
  @ApiProperty({ description: 'The invoice after this payment' }) invoiceStatus: string
  @ApiProperty() invoiceBalanceMinor: number
}
