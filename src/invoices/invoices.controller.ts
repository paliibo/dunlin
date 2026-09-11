import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger'

import { RequireRole } from '../auth/decorators.js'
import { Clock } from '../common/clock.js'
import { DocumentsService } from '../documents/documents.service.js'
import { Idempotent } from '../idempotency/idempotent.decorator.js'
import {
  CreateInvoiceDto,
  InvoiceResponse,
  IssueInvoiceDto,
  ListInvoicesDto,
  VoidInvoiceDto,
} from './dto/invoice.dto.js'
import { InvoicesService, toInvoiceResponse } from './invoices.service.js'

class InvoicePage {
  @ApiProperty({ type: [InvoiceResponse] }) items: InvoiceResponse[]
  @ApiProperty({
    nullable: true,
    description: 'Pass as ?cursor= for the next page; null on the last page',
  })
  nextCursor: string | null
}

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description:
    'Any unique string; a repeat with the same key returns the first response instead of acting twice',
}

@ApiTags('Invoices')
@ApiBearerAuth('api-key')
@Controller('v1/invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly documents: DocumentsService,
    private readonly clock: Clock,
  ) {}

  @Post()
  @RequireRole('accountant')
  @Idempotent()
  @ApiOperation({ summary: 'Create a draft invoice' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiCreatedResponse({ type: InvoiceResponse })
  async create(@Body() dto: CreateInvoiceDto): Promise<InvoiceResponse> {
    return toInvoiceResponse(await this.invoices.create(dto), [], this.clock.today())
  }

  @Get()
  @ApiOperation({ summary: 'List invoices, newest first' })
  @ApiOkResponse({ type: InvoicePage })
  async list(@Query() query: ListInvoicesDto): Promise<InvoicePage> {
    const page = await this.invoices.list(query)
    const today = this.clock.today()
    return {
      items: page.items.map((invoice) => toInvoiceResponse(invoice, [], today)),
      nextCursor: page.nextCursor,
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an invoice with its lines and dunning state' })
  @ApiOkResponse({ type: InvoiceResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceResponse> {
    const invoice = await this.invoices.get(id)
    return toInvoiceResponse(invoice, await this.invoices.notices(id), this.clock.today())
  }

  @Post(':id/issue')
  @RequireRole('accountant')
  @Idempotent()
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue a draft: assign the next number, set the due date, send it' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ type: InvoiceResponse })
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueInvoiceDto,
  ): Promise<InvoiceResponse> {
    const invoice = await this.invoices.issue(id, dto)
    return toInvoiceResponse(invoice, [], this.clock.today())
  }

  @Post(':id/void')
  @RequireRole('accountant')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void an unpaid invoice' })
  @ApiOkResponse({ type: InvoiceResponse })
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
  ): Promise<InvoiceResponse> {
    const invoice = await this.invoices.void(id, dto.reason)
    return toInvoiceResponse(invoice, await this.invoices.notices(id), this.clock.today())
  }

  @Get(':id/pdf')
  @ApiOperation({
    summary: 'The invoice as a PDF; rendered on first request if the worker has not yet',
  })
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    await this.invoices.get(id)
    const document = await this.documents.getOrRender('invoice', id)
    return new StreamableFile(document.body, {
      type: document.contentType,
      disposition: `inline; filename="${document.fileName}"`,
      length: document.sizeBytes,
    })
  }
}
