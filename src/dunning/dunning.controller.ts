import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'

import { RequireRole } from '../auth/decorators.js'
import { Clock } from '../common/clock.js'
import { DocumentsService } from '../documents/documents.service.js'
import { InvoiceResponse } from '../invoices/dto/invoice.dto.js'
import { InvoicesService, toInvoiceResponse } from '../invoices/invoices.service.js'
import { DunningNoticeResponse, DunningRunResponse, RunDunningDto } from './dto/dunning.dto.js'
import { DunningService, toNoticeResponse } from './dunning.service.js'

@ApiTags('Dunning')
@ApiBearerAuth('api-key')
@Controller('v1')
export class DunningController {
  constructor(
    private readonly dunning: DunningService,
    private readonly invoices: InvoicesService,
    private readonly documents: DocumentsService,
    private readonly clock: Clock,
  ) {}

  @Post('dunning/runs')
  @RequireRole('accountant')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the dunning scan now (the worker runs it daily)' })
  @ApiOkResponse({ type: DunningRunResponse })
  async run(@Body() dto: RunDunningDto): Promise<DunningRunResponse> {
    return this.dunning.run(dto.asOf)
  }

  @Get('invoices/:id/dunning')
  @ApiOperation({ summary: 'Notices sent for an invoice' })
  @ApiOkResponse({ type: [DunningNoticeResponse] })
  async notices(@Param('id', ParseUUIDPipe) id: string): Promise<DunningNoticeResponse[]> {
    await this.invoices.get(id)
    return (await this.invoices.notices(id)).map(toNoticeResponse)
  }

  @Post('invoices/:id/dunning/pause')
  @RequireRole('accountant')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop reminders for an invoice, e.g. while a dispute is open' })
  @ApiOkResponse({ type: InvoiceResponse })
  async pause(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceResponse> {
    const invoice = await this.dunning.setPaused(id, true)
    return toInvoiceResponse(invoice, await this.invoices.notices(id), this.clock.today())
  }

  @Post('invoices/:id/dunning/resume')
  @RequireRole('accountant')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume reminders for an invoice' })
  @ApiOkResponse({ type: InvoiceResponse })
  async resume(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceResponse> {
    const invoice = await this.dunning.setPaused(id, false)
    return toInvoiceResponse(invoice, await this.invoices.notices(id), this.clock.today())
  }

  @Get('dunning/notices/:id/pdf')
  @ApiOperation({ summary: 'The reminder letter as a PDF' })
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    await this.dunning.notice(id)
    const document = await this.documents.getOrRender('dunning_notice', id)
    return new StreamableFile(document.body, {
      type: document.contentType,
      disposition: `inline; filename="${document.fileName}"`,
      length: document.sizeBytes,
    })
  }
}
