import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { RequireRole } from '../auth/decorators.js'
import { Idempotent } from '../idempotency/idempotent.decorator.js'
import { PaymentResponse, RecordPaymentDto } from './dto/payment.dto.js'
import { PaymentsService, toPaymentResponse } from './payments.service.js'

@ApiTags('Payments')
@ApiBearerAuth('api-key')
@Controller('v1/invoices/:invoiceId/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @RequireRole('accountant')
  @Idempotent()
  @ApiOperation({ summary: 'Record a payment against an invoice' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: PaymentResponse })
  async record(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: RecordPaymentDto,
  ): Promise<PaymentResponse> {
    return toPaymentResponse(await this.payments.record(invoiceId, dto))
  }

  @Get()
  @ApiOperation({ summary: 'Payments recorded against an invoice, oldest first' })
  @ApiOkResponse({ type: [PaymentResponse] })
  async list(@Param('invoiceId', ParseUUIDPipe) invoiceId: string): Promise<PaymentResponse[]> {
    return (await this.payments.listForInvoice(invoiceId)).map(toPaymentResponse)
  }
}
