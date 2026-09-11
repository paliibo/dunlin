import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

import { ROLES, type Role } from '../../auth/api-key.entity.js'

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Treuhand AG' })
  @IsString()
  @Length(1, 200)
  name: string

  @ApiProperty({ example: 'CH', description: 'ISO 3166-1 alpha-2' })
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country: string

  @ApiProperty({ example: 'CHF', description: 'ISO 4217; every invoice of the tenant uses it' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency: string

  @ApiPropertyOptional({ example: 'INV', default: 'INV' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{1,8}$/)
  invoicePrefix?: string

  @ApiPropertyOptional({ example: 30, default: 14, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number

  @ApiPropertyOptional({
    description:
      'Escalation schedule; see the Dunning section. Defaults to reminder at 3 days, second reminder with a 15.00 fee at 14, final notice with a 40.00 fee at 30, 5 % annual interest.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  dunningPolicy?: Record<string, unknown>
}

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'Acme Treuhand AG' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string

  @ApiPropertyOptional({ example: 'INV' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{1,8}$/)
  invoicePrefix?: string

  @ApiPropertyOptional({ example: 30, minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  dunningPolicy?: Record<string, unknown>
}

export class IssueApiKeyDto {
  @ApiProperty({ example: 'Accounting integration' })
  @IsString()
  @Length(1, 100)
  @MaxLength(100)
  name: string

  @ApiProperty({ enum: ROLES, example: 'accountant' })
  @IsIn(ROLES)
  role: Role
}

export class TenantResponse {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() country: string
  @ApiProperty() currency: string
  @ApiProperty() invoicePrefix: string
  @ApiProperty() paymentTermsDays: number
  @ApiProperty({ type: 'object', additionalProperties: true }) dunningPolicy: Record<
    string,
    unknown
  >
  @ApiProperty() createdAt: string
}

export class ApiKeyResponse {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty({ enum: ROLES }) role: Role
  @ApiProperty({ description: 'The first characters of the key, for identification' })
  keyPrefix: string
  @ApiProperty() createdAt: string
  @ApiProperty({ nullable: true }) lastUsedAt: string | null
  @ApiProperty({ nullable: true }) revokedAt: string | null
}

export class IssuedApiKeyResponse extends ApiKeyResponse {
  @ApiProperty({ description: 'The full key. Shown once; it is not stored.' }) key: string
}

export class CreatedTenantResponse {
  @ApiProperty({ type: TenantResponse }) tenant: TenantResponse
  @ApiProperty({ type: IssuedApiKeyResponse }) apiKey: IssuedApiKeyResponse
}
