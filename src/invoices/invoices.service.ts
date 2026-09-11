import { Inject, Injectable } from '@nestjs/common'
import { In } from 'typeorm'

import { Clock } from '../common/clock.js'
import { addDays, isIsoDate, type IsoDate, yearOf } from '../common/dates.js'
import { ConflictError, NotFoundError, UnprocessableError } from '../common/errors.js'
import { lineAmounts, sumTotals } from '../common/money.js'
import { clampLimit, decodeCursor, encodeCursor, type Page } from '../common/pagination.js'
import { ENV, type Env } from '../config/env.js'
import { Customer } from '../customers/customer.entity.js'
import { DocumentsService } from '../documents/documents.service.js'
import { DunningNotice } from '../dunning/dunning-notice.entity.js'
import { DomainEvents } from '../events/domain-events.service.js'
import { MailService } from '../mail/mail.service.js'
import { invoiceIssuedMail } from '../mail/templates.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { Tenant } from '../tenants/tenant.entity.js'
import type {
  CreateInvoiceDto,
  DunningSummaryResponse,
  InvoiceResponse,
  IssueInvoiceDto,
  ListInvoicesDto,
} from './dto/invoice.dto.js'
import { Invoice, InvoiceLine, OPEN_STATUSES } from './invoice.entity.js'
import { NumberingService } from './numbering.service.js'

export function dunningSummary(invoice: Invoice, notices: DunningNotice[]): DunningSummaryResponse {
  const latest = notices.reduce<DunningNotice | null>(
    (a, b) => (a && a.level > b.level ? a : b),
    null,
  )
  const feesMinor = notices.reduce((sum, notice) => sum + notice.feeMinor, 0)
  const interestMinor = latest?.interestMinor ?? 0
  return {
    level: invoice.dunningLevel,
    paused: invoice.dunningPaused,
    lastNoticeOn: invoice.lastDunnedOn,
    feesMinor,
    interestMinor,
    collectibleMinor: invoice.balanceMinor + feesMinor + interestMinor,
  }
}

export function isOverdue(invoice: Invoice, today: IsoDate): boolean {
  return OPEN_STATUSES.includes(invoice.status) && invoice.dueOn !== null && invoice.dueOn < today
}

export function toInvoiceResponse(
  invoice: Invoice,
  notices: DunningNotice[],
  today: IsoDate,
): InvoiceResponse {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    customerId: invoice.customerId,
    currency: invoice.currency,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn,
    subtotalMinor: invoice.subtotalMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    balanceMinor: invoice.balanceMinor,
    overdue: isOverdue(invoice, today),
    notes: invoice.notes,
    lines: [...(invoice.lines ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        id: line.id,
        position: line.position,
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        taxRateBps: line.taxRateBps,
        netMinor: line.netMinor,
        taxMinor: line.taxMinor,
        totalMinor: line.totalMinor,
      })),
    dunning: dunningSummary(invoice, notices),
    voidedAt: invoice.voidedAt?.toISOString() ?? null,
    voidReason: invoice.voidReason,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  }
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly ctx: TenantContext,
    private readonly clock: Clock,
    private readonly numbering: NumberingService,
    private readonly documents: DocumentsService,
    private readonly mail: MailService,
    private readonly events: DomainEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(dto: CreateInvoiceDto): Promise<Invoice> {
    const customer = await this.ctx.repo(Customer).findOneBy({ id: dto.customerId })
    if (!customer)
      throw new UnprocessableError('unknown_customer', `Customer ${dto.customerId} does not exist`)
    const tenant = await this.tenant()

    const lines = dto.lines.map((line, index) => {
      const amounts = lineAmounts(line)
      return this.ctx.repo(InvoiceLine).create({
        tenantId: this.ctx.tenantId,
        position: index + 1,
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        taxRateBps: line.taxRateBps,
        ...amounts,
      })
    })
    const totals = sumTotals(lines)

    const repo = this.ctx.repo(Invoice)
    const invoice = repo.create({
      tenantId: this.ctx.tenantId,
      customerId: customer.id,
      number: null,
      status: 'draft',
      currency: tenant.currency,
      issuedOn: null,
      dueOn: null,
      ...totals,
      paidMinor: 0,
      notes: dto.notes ?? null,
      lines,
    })
    return repo.save(invoice)
  }

  async get(id: string): Promise<Invoice> {
    const invoice = await this.ctx
      .repo(Invoice)
      .findOne({ where: { id }, relations: { lines: true } })
    if (!invoice) throw new NotFoundError('Invoice', id)
    return invoice
  }

  /** Locks the row for the rest of the transaction — for anything that changes money. */
  async getForUpdate(id: string): Promise<Invoice> {
    const invoice = await this.ctx
      .repo(Invoice)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } })
    if (!invoice) throw new NotFoundError('Invoice', id)
    invoice.lines = await this.ctx.repo(InvoiceLine).findBy({ invoiceId: id })
    return invoice
  }

  async notices(invoiceId: string): Promise<DunningNotice[]> {
    return this.ctx.repo(DunningNotice).find({ where: { invoiceId }, order: { level: 'ASC' } })
  }

  async list(query: ListInvoicesDto): Promise<Page<Invoice>> {
    const limit = clampLimit(query.limit)
    const cursor = decodeCursor(query.cursor)

    // Page the invoices first, without the lines: a LIMIT over a joined result
    // counts line rows, not invoices.
    const qb = this.ctx
      .repo(Invoice)
      .createQueryBuilder('i')
      .select(['i.id', 'i.createdAt'])
      .orderBy('i.created_at', 'DESC')
      .addOrderBy('i.id', 'DESC')
      .take(limit + 1)
    if (query.status) qb.andWhere('i.status = :status', { status: query.status })
    if (query.customerId)
      qb.andWhere('i.customer_id = :customerId', { customerId: query.customerId })
    if (query.overdue === 'true') {
      qb.andWhere('i.status in (:...open)', { open: OPEN_STATUSES }).andWhere('i.due_on < :today', {
        today: this.clock.today(),
      })
    }
    if (cursor) qb.andWhere('(i.created_at, i.id) < (:createdAt, :id)', cursor)

    const heads = await qb.getMany()
    const page = heads.slice(0, limit)
    if (page.length === 0) return { items: [], nextCursor: null }

    const items = await this.ctx.repo(Invoice).find({
      where: { id: In(page.map((head) => head.id)) },
      relations: { lines: true },
      order: { createdAt: 'DESC', id: 'DESC', lines: { position: 'ASC' } },
    })
    const last = page.at(-1) as Invoice
    return {
      items,
      nextCursor:
        heads.length > limit
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    }
  }

  async issue(id: string, dto: IssueInvoiceDto): Promise<Invoice> {
    const invoice = await this.getForUpdate(id)
    if (invoice.status !== 'draft') {
      throw new ConflictError(
        'invoice_not_draft',
        `Invoice ${id} is ${invoice.status}; only drafts can be issued`,
      )
    }
    if (invoice.lines.length === 0) {
      throw new UnprocessableError(
        'invoice_has_no_lines',
        'An invoice needs at least one line to be issued',
      )
    }
    if (dto.issuedOn !== undefined && !isIsoDate(dto.issuedOn)) {
      throw new UnprocessableError('invalid_date', 'issuedOn must be a calendar date, YYYY-MM-DD')
    }

    const tenant = await this.tenant()
    const customer = await this.ctx.repo(Customer).findOneByOrFail({ id: invoice.customerId })
    const issuedOn = dto.issuedOn ?? this.clock.today()
    const terms = customer.paymentTermsDays ?? tenant.paymentTermsDays

    invoice.number = await this.numbering.next(yearOf(issuedOn), tenant.invoicePrefix)
    invoice.status = 'issued'
    invoice.issuedOn = issuedOn
    invoice.dueOn = addDays(issuedOn, terms)
    await this.ctx.repo(Invoice).save(invoice)

    this.documents.scheduleRender('invoice', invoice.id)
    if (customer.email) {
      const content = invoiceIssuedMail(tenant, invoice, customer.name, this.pdfUrl(invoice.id))
      await this.mail.queueMessage({
        to: customer.email,
        ...content,
        template: 'invoice_issued',
        subjectId: invoice.id,
      })
    }
    await this.events.emit('invoice.issued', this.eventData(invoice))
    return invoice
  }

  async void(id: string, reason: string | undefined): Promise<Invoice> {
    const invoice = await this.getForUpdate(id)
    if (invoice.status === 'void') return invoice
    if (invoice.paidMinor > 0) {
      throw new ConflictError(
        'invoice_has_payments',
        `Invoice ${id} has recorded payments and cannot be voided`,
      )
    }
    if (invoice.status === 'paid') {
      throw new ConflictError('invoice_paid', `Invoice ${id} is paid and cannot be voided`)
    }
    invoice.status = 'void'
    invoice.voidedAt = this.clock.now()
    invoice.voidReason = reason ?? null
    await this.ctx.repo(Invoice).save(invoice)
    await this.events.emit('invoice.voided', { ...this.eventData(invoice), reason: reason ?? null })
    return invoice
  }

  pdfUrl(invoiceId: string): string {
    return `${this.env.PUBLIC_BASE_URL}/v1/invoices/${invoiceId}/pdf`
  }

  eventData(invoice: Invoice): Record<string, unknown> {
    return {
      invoiceId: invoice.id,
      number: invoice.number,
      status: invoice.status,
      customerId: invoice.customerId,
      currency: invoice.currency,
      totalMinor: invoice.totalMinor,
      paidMinor: invoice.paidMinor,
      balanceMinor: invoice.balanceMinor,
      dueOn: invoice.dueOn,
    }
  }

  private async tenant(): Promise<Tenant> {
    const tenant = await this.ctx.manager.findOneBy(Tenant, { id: this.ctx.tenantId })
    if (!tenant) throw new NotFoundError('Tenant', this.ctx.tenantId)
    return tenant
  }
}
