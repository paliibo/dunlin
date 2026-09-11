import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'

import { NotFoundError } from '../common/errors.js'
import { Customer } from '../customers/customer.entity.js'
import { DunningNotice } from '../dunning/dunning-notice.entity.js'
import { Invoice } from '../invoices/invoice.entity.js'
import { QUEUES } from '../queues/queues.module.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { Tenant } from '../tenants/tenant.entity.js'
import { type DocumentKind, StoredDocument } from './document.entity.js'
import { renderDunningNoticePdf, renderInvoicePdf } from './pdf.js'

export interface RenderJob {
  tenantId: string
  kind: DocumentKind
  subjectId: string
}

/**
 * PDFs are rendered by a worker as soon as the thing they describe is
 * committed, and on demand if someone asks before the worker got there.
 * Either way the result is stored once: the two do race, and the insert is
 * `ON CONFLICT DO NOTHING` rather than a caught unique violation, because a
 * failed statement would abort the surrounding transaction.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly ctx: TenantContext,
    @InjectQueue(QUEUES.documents) private readonly queue: Queue<RenderJob>,
  ) {}

  scheduleRender(kind: DocumentKind, subjectId: string): void {
    const tenantId = this.ctx.tenantId
    this.ctx.afterCommit(() =>
      this.queue.add(
        'render',
        { tenantId, kind, subjectId },
        {
          jobId: `doc-${kind}-${subjectId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000 },
        },
      ),
    )
  }

  async find(kind: DocumentKind, subjectId: string): Promise<StoredDocument | null> {
    return this.ctx.repo(StoredDocument).findOneBy({ kind, subjectId })
  }

  async getOrRender(kind: DocumentKind, subjectId: string): Promise<StoredDocument> {
    const existing = await this.find(kind, subjectId)
    if (existing) return existing

    const { fileName, body } = await this.render(kind, subjectId)
    await this.ctx
      .repo(StoredDocument)
      .createQueryBuilder()
      .insert()
      .values({
        tenantId: this.ctx.tenantId,
        kind,
        subjectId,
        fileName,
        contentType: 'application/pdf',
        body,
        sizeBytes: body.byteLength,
      })
      .orIgnore()
      .execute()

    const stored = await this.find(kind, subjectId)
    if (!stored) throw new Error(`Document ${kind}/${subjectId} missing after insert`)
    return stored
  }

  private async render(
    kind: DocumentKind,
    subjectId: string,
  ): Promise<{ fileName: string; body: Buffer }> {
    const tenant = await this.ctx.manager.findOneByOrFail(Tenant, { id: this.ctx.tenantId })
    if (kind === 'invoice') {
      const invoice = await this.loadInvoice(subjectId)
      const customer = await this.ctx.repo(Customer).findOneByOrFail({ id: invoice.customerId })
      return {
        fileName: `${invoice.number ?? invoice.id}.pdf`,
        body: await renderInvoicePdf(tenant, customer, invoice),
      }
    }
    const notice = await this.ctx.repo(DunningNotice).findOneBy({ id: subjectId })
    if (!notice) throw new NotFoundError('Dunning notice', subjectId)
    const invoice = await this.loadInvoice(notice.invoiceId)
    const customer = await this.ctx.repo(Customer).findOneByOrFail({ id: invoice.customerId })
    return {
      fileName: `${invoice.number ?? invoice.id}-notice-${notice.level}.pdf`,
      body: await renderDunningNoticePdf(tenant, customer, invoice, notice),
    }
  }

  private async loadInvoice(id: string): Promise<Invoice> {
    const invoice = await this.ctx
      .repo(Invoice)
      .findOne({ where: { id }, relations: { lines: true } })
    if (!invoice) throw new NotFoundError('Invoice', id)
    if (invoice.status === 'draft') throw new NotFoundError('Document for draft invoice', id)
    return invoice
  }
}
