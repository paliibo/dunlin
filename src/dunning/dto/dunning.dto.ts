import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, Matches } from 'class-validator'

export class RunDunningDto {
  @ApiPropertyOptional({
    example: '2026-10-15',
    description: 'Evaluate overdue-ness as of this date; defaults to today',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  asOf?: string
}

export class EscalatedInvoiceResponse {
  @ApiProperty() invoiceId: string
  @ApiProperty({ nullable: true }) number: string | null
  @ApiProperty() level: number
  @ApiProperty() noticeId: string
  @ApiProperty() daysOverdue: number
  @ApiProperty() feeMinor: number
  @ApiProperty() interestMinor: number
}

export class DunningRunResponse {
  @ApiProperty() asOf: string
  @ApiProperty({ description: 'Open invoices past due that were considered' }) considered: number
  @ApiProperty({ type: [EscalatedInvoiceResponse] }) escalated: EscalatedInvoiceResponse[]
}

export class DunningNoticeResponse {
  @ApiProperty() id: string
  @ApiProperty() invoiceId: string
  @ApiProperty() level: number
  @ApiProperty() template: string
  @ApiProperty() issuedOn: string
  @ApiProperty() respondBy: string
  @ApiProperty() daysOverdue: number
  @ApiProperty() balanceMinor: number
  @ApiProperty() feeMinor: number
  @ApiProperty() interestMinor: number
  @ApiProperty() createdAt: string
}
