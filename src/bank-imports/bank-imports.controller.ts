import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { RequireRole } from '../auth/decorators.js'
import { Idempotent } from '../idempotency/idempotent.decorator.js'
import { BankImportsService, toBankImportResponse } from './bank-imports.service.js'
import { BankImportResponse, CreateBankImportDto } from './dto/bank-import.dto.js'

@ApiTags('Bank imports')
@ApiBearerAuth('api-key')
@Controller('v1/bank-imports')
export class BankImportsController {
  constructor(private readonly imports: BankImportsService) {}

  @Post()
  @RequireRole('accountant')
  @Idempotent()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Submit statement lines for reconciliation; matching runs in the background',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiAcceptedResponse({ type: BankImportResponse })
  async create(@Body() dto: CreateBankImportDto): Promise<BankImportResponse> {
    const { record, lines } = await this.imports.create(dto)
    return toBankImportResponse(record, lines)
  }

  @Get(':id')
  @ApiOperation({ summary: 'An import with every line and its outcome' })
  @ApiOkResponse({ type: BankImportResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<BankImportResponse> {
    const { record, lines } = await this.imports.get(id)
    return toBankImportResponse(record, lines)
  }
}
