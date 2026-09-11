import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { type Job, Queue } from 'bullmq'
import { DataSource, LessThan } from 'typeorm'

import { BankImport } from '../bank-imports/bank-import.entity.js'
import { BankImportsService } from '../bank-imports/bank-imports.service.js'
import { DomainEvents } from '../events/domain-events.service.js'
import { MailService } from '../mail/mail.service.js'
import { OutboxMessage } from '../mail/outbox.entity.js'
import { QUEUES } from '../queues/queues.module.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { UnitOfWork } from '../tenancy/unit-of-work.js'
import { Tenant } from '../tenants/tenant.entity.js'
import { WebhookDelivery } from '../webhooks/webhook.entity.js'

export const SWEEP_JOB = 'sweep'
export const SWEEP_EVERY_MS = 60_000
const STALE_AFTER_MS = 2 * 60_000

/**
 * The safety net under the outbox pattern. Rows are written inside the
 * transaction and their jobs enqueued after commit; if the process dies in
 * between, the row is committed and the job is not. Every minute this walks
 * each tenant's queued rows older than two minutes and enqueues them again.
 * Job ids are deterministic, so a job that does exist is simply not added
 * twice.
 */
@Injectable()
export class Sweeper {
  private readonly logger = new Logger(Sweeper.name)

  constructor(
    private readonly uow: UnitOfWork,
    private readonly ctx: TenantContext,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mail: MailService,
    private readonly events: DomainEvents,
    private readonly imports: BankImportsService,
  ) {}

  async sweep(): Promise<{ mail: number; webhooks: number; imports: number }> {
    const tenants = await this.dataSource.manager.find(Tenant, { select: { id: true } })
    const staleBefore = new Date(Date.now() - STALE_AFTER_MS)
    const totals = { mail: 0, webhooks: 0, imports: 0 }
    for (const tenant of tenants) {
      await this.uow.run(tenant.id, async () => {
        const messages = await this.ctx
          .repo(OutboxMessage)
          .findBy({ status: 'queued', createdAt: LessThan(staleBefore) })
        for (const message of messages) await this.mail.enqueue(message)
        const deliveries = await this.ctx
          .repo(WebhookDelivery)
          .findBy({ status: 'pending', createdAt: LessThan(staleBefore) })
        if (deliveries.length) await this.events.enqueue(deliveries)
        const imports = await this.ctx
          .repo(BankImport)
          .findBy({ status: 'queued', createdAt: LessThan(staleBefore) })
        for (const record of imports) await this.imports.enqueue(record)
        totals.mail += messages.length
        totals.webhooks += deliveries.length
        totals.imports += imports.length
      })
    }
    if (totals.mail + totals.webhooks + totals.imports > 0)
      this.logger.log(totals, 'sweeper re-enqueued stale work')
    return totals
  }
}

@Processor(QUEUES.maintenance)
export class SweeperProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly sweeper: Sweeper,
    @InjectQueue(QUEUES.maintenance) private readonly queue: Queue,
  ) {
    super()
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'outbox-sweep',
      { every: SWEEP_EVERY_MS },
      { name: SWEEP_JOB, data: {} },
    )
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== SWEEP_JOB) return undefined
    return this.sweeper.sweep()
  }
}
