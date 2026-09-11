import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

import { MAX_MINOR } from '../../common/money.js'
import {
  IMPORT_STATUSES,
  type ImportStatus,
  LINE_STATUSES,
  type LineStatus,
} from '../bank-import.entity.js'

export class BankLineDto {
  @ApiProperty({ example: '2026-09-14' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) bookedOn: string

  @ApiProperty({
    example: 43_200,
    description: 'Minor units; credits are positive, debits negative',
  })
  @IsInt()
  @Min(-MAX_MINOR)
  @Max(MAX_MINOR)
  amountMinor: number

  @ApiProperty({ example: 'CHF' }) @Matches(/^[A-Z]{3}$/) currency: string

  @ApiPropertyOptional({ example: 'MUSTER GMBH' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  counterparty?: string

  @ApiPropertyOptional({ example: 'Payment INV-2026-0001' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reference?: string
}

export class CreateBankImportDto {
  @ApiPropertyOptional({ example: 'camt.053 2026-09-15' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceName?: string

  @ApiProperty({ type: [BankLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => BankLineDto)
  lines: BankLineDto[]
}

export class BankImportLineResponse {
  @ApiProperty() id: string
  @ApiProperty() position: number
  @ApiProperty() bookedOn: string
  @ApiProperty() amountMinor: number
  @ApiProperty() currency: string
  @ApiProperty({ nullable: true }) counterparty: string | null
  @ApiProperty({ nullable: true }) reference: string | null
  @ApiProperty({ enum: LINE_STATUSES }) status: LineStatus
  @ApiProperty({ nullable: true }) invoiceId: string | null
  @ApiProperty({ nullable: true }) paymentId: string | null
  @ApiProperty({ nullable: true, description: 'How it matched, or why it did not' }) reason:
    string | null
}

export class BankImportResponse {
  @ApiProperty() id: string
  @ApiProperty({ enum: IMPORT_STATUSES }) status: ImportStatus
  @ApiProperty({ nullable: true }) sourceName: string | null
  @ApiProperty() lineCount: number
  @ApiProperty() matchedCount: number
  @ApiProperty() unmatchedCount: number
  @ApiProperty({ nullable: true }) error: string | null
  @ApiProperty() createdAt: string
  @ApiProperty({ nullable: true }) completedAt: string | null
  @ApiProperty({ type: [BankImportLineResponse] }) lines: BankImportLineResponse[]
}
