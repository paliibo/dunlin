import { Injectable } from '@nestjs/common'
import { In, LessThan } from 'typeorm'

import { Clock } from '../common/clock.js'
import { isIsoDate, type IsoDate } from '../common/dates.js'
import { NotFoundError, UnprocessableError } from '../common/errors.js'
import { Customer } from '../customers/customer.entity.js'
import { DocumentsService } from '../documents/documents.service.js'
import { DomainEvents } from '../events/domain-events.service.js'
import { Invoice, OPEN_STATUSES } from '../invoices/invoice.entity.js'
import { InvoicesService } from '../invoices/invoices.service.js'
import { MailService } from '../mail/mail.service.js'
import { dunningNoticeMail } from '../mail/templates.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { Tenant } from '../tenants/tenant.entity.js'
import type { DunningNoticeResponse, DunningRunResponse } from './dto/dunning.dto.js'
import { DunningNotice } from './dunning-notice.entity.js'
import { planEscalation } from './policy.js'

export function toNoticeResponse(notice: DunningNotice): DunningNoticeResponse {
  return {
    id: notice.id,
    invoiceId: notice.invoiceId,
    level: notice.level,
    template: notice.template,
    issuedOn: notice.issuedOn,
    respondBy: notice.respondBy,
    daysOverdue: notice.daysOverdue,
    balanceMinor: notice.balanceMinor,
    feeMinor: notice.feeMinor,
    interestMinor: notice.interestMinor,
    createdAt: notice.createdAt.toISOString(),
  }
}

@Injectable()
export class DunningService {
  constructor(
    private readonly ctx: TenantContext,
    private readonly clock: Clock,
    private readonly invoices: InvoicesService,
    private readonly documents: DocumentsService,
    private readonly mail: MailService,
    private readonly events: DomainEvents,
  ) {}

  /** One pass over the tenant's overdue invoices: each gets at most one step up. */
  async run(asOfInput?: string): Promise<DunningRunResponse> {
    if (asOfInput !== undefined && !isIsoDate(asOfInput)) {
      throw new UnprocessableError('invalid_date', 'asOf must be a calendar date, YYYY-MM-DD')
    }
    const asOf: IsoDate = asOfInput ?? this.clock.today()
    const tenant = await this.ctx.manager.findOneByOrFail(Tenant, { id: this.ctx.tenantId })
    const policy = tenant.dunningPolicy

    const candidates = await this.ctx.repo(Invoice).find({
      where: { status: In([...OPEN_STATUSES]), dunningPaused: false, dueOn: LessThan(asOf) },
      order: { dueOn: 'ASC' },
    })

    const escalated: DunningRunResponse['escalated'] = []
    for (const candidate of candidates) {
      const invoice = await this.invoices.getForUpdate(candidate.id)
      const plan = planEscalation(invoice, policy, asOf)
      if (!plan) continue

      const repo = this.ctx.repo(DunningNotice)
      const notice = await repo.save(
        repo.create({
          tenantId: this.ctx.tenantId,
          invoiceId: invoice.id,
          level: plan.level,
          template: plan.definition.template,
          issuedOn: asOf,
          respondBy: plan.respondBy,
          daysOverdue: plan.daysOverdue,
          balanceMinor: invoice.balanceMinor,
          feeMinor: plan.feeMinor,
          interestMinor: plan.interestMinor,
        }),
      )
      invoice.dunningLevel = plan.level
      invoice.lastDunnedOn = asOf
      await this.ctx.repo(Invoice).save(invoice)

      this.documents.scheduleRender('dunning_notice', notice.id)
      const customer = await this.ctx.repo(Customer).findOneByOrFail({ id: invoice.customerId })
      if (customer.email) {
        const content = dunningNoticeMail(
          tenant,
          invoice,
          notice,
          customer.name,
          this.noticePdfUrl(notice.id),
        )
        await this.mail.queueMessage({
          to: customer.email,
          ...content,
          template: `dunning_${notice.template}`,
          subjectId: notice.id,
        })
      }
      await this.events.emit('dunning.notice_created', {
        noticeId: notice.id,
        level: notice.level,
        template: notice.template,
        feeMinor: notice.feeMinor,
        interestMinor: notice.interestMinor,
        respondBy: notice.respondBy,
        ...this.invoices.eventData(invoice),
      })
      escalated.push({
        invoiceId: invoice.id,
        number: invoice.number,
        level: notice.level,
        noticeId: notice.id,
        daysOverdue: notice.daysOverdue,
        feeMinor: notice.feeMinor,
        interestMinor: notice.interestMinor,
      })
    }

    return { asOf, considered: candidates.length, escalated }
  }

  async setPaused(invoiceId: string, paused: boolean): Promise<Invoice> {
    const invoice = await this.invoices.getForUpdate(invoiceId)
    invoice.dunningPaused = paused
    return this.ctx.repo(Invoice).save(invoice)
  }

  async notice(id: string): Promise<DunningNotice> {
    const notice = await this.ctx.repo(DunningNotice).findOneBy({ id })
    if (!notice) throw new NotFoundError('Dunning notice', id)
    return notice
  }

  noticePdfUrl(noticeId: string): string {
    return `${this.invoices.pdfUrl('').replace(/\/v1\/invoices\/\/pdf$/, '')}/v1/dunning/notices/${noticeId}/pdf`
  }
}
