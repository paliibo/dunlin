import { Injectable } from '@nestjs/common'

import { isIsoDate } from '../common/dates.js'
import { ConflictError, UnprocessableError } from '../common/errors.js'
import { DomainEvents } from '../events/domain-events.service.js'
import { Invoice, OPEN_STATUSES } from '../invoices/invoice.entity.js'
import { InvoicesService } from '../invoices/invoices.service.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import type { PaymentResponse, RecordPaymentDto } from './dto/payment.dto.js'
import { Payment, type PaymentSource } from './payment.entity.js'

export interface RecordedPayment {
  payment: Payment
  invoice: Invoice
}

export function toPaymentResponse({ payment, invoice }: RecordedPayment): PaymentResponse {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    receivedOn: payment.receivedOn,
    method: payment.method,
    reference: payment.reference,
    source: payment.source,
    bankImportLineId: payment.bankImportLineId,
    createdAt: payment.createdAt.toISOString(),
    invoiceStatus: invoice.status,
    invoiceBalanceMinor: invoice.balanceMinor,
  }
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly ctx: TenantContext,
    private readonly invoices: InvoicesService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Applies a payment to one invoice under a row lock, so two payments landing
   * at once cannot both see the same balance and overshoot it together.
   */
  async record(
    invoiceId: string,
    dto: RecordPaymentDto,
    source: PaymentSource = 'manual',
    bankImportLineId: string | null = null,
  ): Promise<RecordedPayment> {
    if (!isIsoDate(dto.receivedOn)) {
      throw new UnprocessableError('invalid_date', 'receivedOn must be a calendar date, YYYY-MM-DD')
    }
    const invoice = await this.invoices.getForUpdate(invoiceId)
    if (!OPEN_STATUSES.includes(invoice.status)) {
      throw new ConflictError(
        'invoice_not_open',
        `Invoice ${invoiceId} is ${invoice.status}; payments apply to issued invoices`,
      )
    }
    if (dto.amountMinor > invoice.balanceMinor) {
      throw new UnprocessableError(
        'overpayment',
        `Amount ${dto.amountMinor} exceeds the open balance of ${invoice.balanceMinor}`,
        {
          balanceMinor: invoice.balanceMinor,
        },
      )
    }

    const repo = this.ctx.repo(Payment)
    const payment = await repo.save(
      repo.create({
        tenantId: this.ctx.tenantId,
        invoiceId,
        amountMinor: dto.amountMinor,
        currency: invoice.currency,
        receivedOn: dto.receivedOn,
        method: dto.method,
        reference: dto.reference ?? null,
        source,
        bankImportLineId,
      }),
    )

    invoice.paidMinor += dto.amountMinor
    invoice.status = invoice.balanceMinor === 0 ? 'paid' : 'partially_paid'
    await this.ctx.repo(Invoice).save(invoice)

    await this.events.emit('payment.recorded', {
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      source,
      ...this.invoices.eventData(invoice),
    })
    if (invoice.status === 'paid')
      await this.events.emit('invoice.paid', this.invoices.eventData(invoice))

    return { payment, invoice }
  }

  async listForInvoice(invoiceId: string): Promise<RecordedPayment[]> {
    const invoice = await this.invoices.get(invoiceId)
    const payments = await this.ctx
      .repo(Payment)
      .find({ where: { invoiceId }, order: { createdAt: 'ASC' } })
    return payments.map((payment) => ({ payment, invoice }))
  }
}
