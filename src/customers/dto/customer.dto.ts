import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

export class AddressDto {
  @ApiProperty({ example: 'Bahnhofstrasse 1' }) @IsString() @Length(1, 200) line1: string
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) line2?: string
  @ApiProperty({ example: '8001' }) @IsString() @Length(1, 20) postalCode: string
  @ApiProperty({ example: 'Zürich' }) @IsString() @Length(1, 100) city: string
  @ApiProperty({ example: 'CH' }) @IsString() @Matches(/^[A-Z]{2}$/) country: string
}

export class CreateCustomerDto {
  @ApiProperty({ example: 'Muster GmbH' }) @IsString() @Length(1, 200) name: string
  @ApiPropertyOptional({ example: 'ap@muster.example' }) @IsOptional() @IsEmail() email?: string
  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto
  @ApiPropertyOptional({ example: 'CHE-123.456.789' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  vatId?: string
  @ApiPropertyOptional({ description: 'Overrides the tenant default', minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number
}

export class UpdateCustomerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string
  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) vatId?: string
  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number
}

export class ListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page' })
  @IsOptional()
  @IsString()
  cursor?: string
}

export class CustomerResponse {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty({ nullable: true }) email: string | null
  @ApiProperty({ type: AddressDto, nullable: true }) address: AddressDto | null
  @ApiProperty({ nullable: true }) vatId: string | null
  @ApiProperty({ nullable: true }) paymentTermsDays: number | null
  @ApiProperty() createdAt: string
  @ApiProperty() updatedAt: string
}
