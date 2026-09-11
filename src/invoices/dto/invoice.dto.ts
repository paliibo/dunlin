import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

import { MAX_MINOR } from '../../common/money.js'
import { ListQueryDto } from '../../customers/dto/customer.dto.js'
import { INVOICE_STATUSES, type InvoiceStatus } from '../invoice.entity.js'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export class InvoiceLineDto {
  @ApiProperty({ example: 'Consulting, September' }) @IsString() @Length(1, 500) description: string

  @ApiProperty({ example: 12.5, description: 'Up to three decimals' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number

  @ApiProperty({ example: 18_000, description: 'Minor units (cents, rappen)' })
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  unitPriceMinor: number

  @ApiProperty({ example: 810, description: 'Basis points: 810 is 8.1 %' })
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxRateBps: number
}

export class CreateInvoiceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() customerId: string

  @ApiProperty({ type: [InvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[]

  @ApiPropertyOptional({ example: 'Payable within 30 days.' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string
}

export class IssueInvoiceDto {
  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Defaults to today; the due date follows from the payment terms',
  })
  @IsOptional()
  @Matches(ISO_DATE)
  issuedOn?: string
}

export class VoidInvoiceDto {
  @ApiPropertyOptional({ example: 'Issued to the wrong customer' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

export class ListInvoicesDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() customerId?: string
  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Only open invoices past their due date',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  overdue?: 'true' | 'false'
}

export class InvoiceLineResponse {
  @ApiProperty() id: string
  @ApiProperty() position: number
  @ApiProperty() description: string
  @ApiProperty() quantity: number
  @ApiProperty() unitPriceMinor: number
  @ApiProperty() taxRateBps: number
  @ApiProperty() netMinor: number
  @ApiProperty() taxMinor: number
  @ApiProperty() totalMinor: number
}

export class DunningSummaryResponse {
  @ApiProperty({ description: 'Highest level reached; 0 before the first reminder' }) level: number
  @ApiProperty() paused: boolean
  @ApiProperty({ nullable: true }) lastNoticeOn: string | null
  @ApiProperty({ description: 'Reminder fees charged so far' }) feesMinor: number
  @ApiProperty({ description: 'Interest stated on the latest notice' }) interestMinor: number
  @ApiProperty({ description: 'Open balance plus fees and interest' }) collectibleMinor: number
}

export class InvoiceResponse {
  @ApiProperty() id: string
  @ApiProperty({ nullable: true }) number: string | null
  @ApiProperty({ enum: INVOICE_STATUSES }) status: InvoiceStatus
  @ApiProperty() customerId: string
  @ApiProperty() currency: string
  @ApiProperty({ nullable: true }) issuedOn: string | null
  @ApiProperty({ nullable: true }) dueOn: string | null
  @ApiProperty() subtotalMinor: number
  @ApiProperty() taxMinor: number
  @ApiProperty() totalMinor: number
  @ApiProperty() paidMinor: number
  @ApiProperty() balanceMinor: number
  @ApiProperty({ description: 'Open and past due, as of today' }) overdue: boolean
  @ApiProperty({ nullable: true }) notes: string | null
  @ApiProperty({ type: [InvoiceLineResponse] }) lines: InvoiceLineResponse[]
  @ApiProperty({ type: DunningSummaryResponse }) dunning: DunningSummaryResponse
  @ApiProperty({ nullable: true }) voidedAt: string | null
  @ApiProperty({ nullable: true }) voidReason: string | null
  @ApiProperty() createdAt: string
  @ApiProperty() updatedAt: string
}
