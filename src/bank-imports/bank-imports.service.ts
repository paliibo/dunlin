import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Queue } from 'bullmq'
import { In } from 'typeorm'

import { isIsoDate } from '../common/dates.js'
import { NotFoundError, UnprocessableError } from '../common/errors.js'
import { Customer } from '../customers/customer.entity.js'
import { DomainEvents } from '../events/domain-events.service.js'
import { Invoice, OPEN_STATUSES } from '../invoices/invoice.entity.js'
import { PaymentsService } from '../payments/payments.service.js'
import { QUEUES } from '../queues/queues.module.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { BankImport, BankImportLine } from './bank-import.entity.js'
import type { BankImportResponse, CreateBankImportDto } from './dto/bank-import.dto.js'
import { matchLine, type OpenInvoiceCandidate } from './matcher.js'

export interface ReconcileJob {
  tenantId: string
  importId: string
}

export function toBankImportResponse(
  record: BankImport,
  lines: BankImportLine[],
): BankImportResponse {
  return {
    id: record.id,
    status: record.status,
    sourceName: record.sourceName,
    lineCount: record.lineCount,
    matchedCount: record.matchedCount,
    unmatchedCount: record.unmatchedCount,
    error: record.error,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    lines: [...lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        id: line.id,
        position: line.position,
        bookedOn: line.bookedOn,
        amountMinor: line.amountMinor,
        currency: line.currency,
        counterparty: line.counterparty,
        reference: line.reference,
        status: line.status,
        invoiceId: line.invoiceId,
        paymentId: line.paymentId,
        reason: line.reason,
      })),
  }
}

@Injectable()
export class BankImportsService {
  private readonly logger = new Logger(BankImportsService.name)

  constructor(
    private readonly ctx: TenantContext,
    private readonly payments: PaymentsService,
    private readonly events: DomainEvents,
    @InjectQueue(QUEUES.bankImports) private readonly queue: Queue<ReconcileJob>,
  ) {}

  async create(dto: CreateBankImportDto): Promise<{ record: BankImport; lines: BankImportLine[] }> {
    const bad = dto.lines.findIndex((line) => !isIsoDate(line.bookedOn))
    if (bad >= 0)
      throw new UnprocessableError('invalid_date', `lines.${bad}.bookedOn is not a calendar date`)

    const imports = this.ctx.repo(BankImport)
    const record = await imports.save(
      imports.create({
        tenantId: this.ctx.tenantId,
        status: 'queued',
        sourceName: dto.sourceName ?? null,
        lineCount: dto.lines.length,
      }),
    )
    const lineRepo = this.ctx.repo(BankImportLine)
    const lines = await lineRepo.save(
      dto.lines.map((line, index) =>
        lineRepo.create({
          tenantId: this.ctx.tenantId,
          importId: record.id,
          position: index + 1,
          bookedOn: line.bookedOn,
          amountMinor: line.amountMinor,
          currency: line.currency,
          counterparty: line.counterparty ?? null,
          reference: line.reference ?? null,
          status: 'pending',
        }),
      ),
    )
    this.ctx.afterCommit(() => this.enqueue(record))
    return { record, lines }
  }

  async enqueue(record: Pick<BankImport, 'id' | 'tenantId'>): Promise<void> {
    await this.queue.add(
      'reconcile',
      { tenantId: record.tenantId, importId: record.id },
      { jobId: `import-${record.id}`, attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
    )
  }

  async get(id: string): Promise<{ record: BankImport; lines: BankImportLine[] }> {
    const record = await this.ctx.repo(BankImport).findOneBy({ id })
    if (!record) throw new NotFoundError('Bank import', id)
    const lines = await this.ctx
      .repo(BankImportLine)
      .find({ where: { importId: id }, order: { position: 'ASC' } })
    return { record, lines }
  }

  /**
   * Worker entry point, inside the tenant's unit of work. Each line is matched
   * against the open invoices as they stand *after* the lines before it, so a
   * statement with two payments for one invoice settles it rather than
   * double-crediting it.
   */
  async reconcile(importId: string): Promise<BankImport> {
    const { record, lines } = await this.get(importId)
    if (record.status === 'completed') return record
    record.status = 'processing'
    await this.ctx.repo(BankImport).save(record)

    const candidates = await this.openInvoices()
    let matched = 0
    let unmatched = 0
    for (const line of lines) {
      if (line.status !== 'pending') {
        if (line.status === 'matched') matched++
        else unmatched++
        continue
      }
      const result = matchLine(line, candidates)
      if (result.kind === 'match') {
        const { payment, invoice } = await this.payments.record(
          result.invoiceId,
          {
            amountMinor: line.amountMinor,
            receivedOn: line.bookedOn,
            method: 'bank_transfer',
            reference: line.reference ?? undefined,
          },
          'bank_import',
          line.id,
        )
        const candidate = candidates.find((c) => c.id === invoice.id)
        if (candidate) candidate.balanceMinor = invoice.balanceMinor
        line.status = 'matched'
        line.invoiceId = invoice.id
        line.paymentId = payment.id
        line.reason = result.reason
        matched++
      } else {
        line.status = 'unmatched'
        line.reason = result.reason
        unmatched++
      }
      await this.ctx.repo(BankImportLine).save(line)
    }

    record.status = 'completed'
    record.matchedCount = matched
    record.unmatchedCount = unmatched
    record.completedAt = new Date()
    await this.ctx.repo(BankImport).save(record)
    await this.events.emit('bank_import.completed', {
      importId: record.id,
      lineCount: record.lineCount,
      matchedCount: matched,
      unmatchedCount: unmatched,
    })
    this.logger.log({ importId, matched, unmatched }, 'bank import reconciled')
    return record
  }

  async markFailed(importId: string, error: string): Promise<void> {
    await this.ctx.repo(BankImport).update({ id: importId }, { status: 'failed', error })
  }

  private async openInvoices(): Promise<OpenInvoiceCandidate[]> {
    const invoices = await this.ctx.repo(Invoice).findBy({ status: In([...OPEN_STATUSES]) })
    if (invoices.length === 0) return []
    const customers = await this.ctx
      .repo(Customer)
      .findBy({ id: In([...new Set(invoices.map((i) => i.customerId))]) })
    const names = new Map(customers.map((c) => [c.id, c.name]))
    return invoices
      .filter((invoice) => invoice.number !== null)
      .map((invoice) => ({
        id: invoice.id,
        number: invoice.number as string,
        customerName: names.get(invoice.customerId) ?? '',
        balanceMinor: invoice.balanceMinor,
        currency: invoice.currency,
      }))
  }
}
