import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { type Job, Queue } from 'bullmq'
import { DataSource } from 'typeorm'

import { BankImportsService, type ReconcileJob } from '../bank-imports/bank-imports.service.js'
import { DocumentsService, type RenderJob } from '../documents/documents.service.js'
import { DunningService } from '../dunning/dunning.service.js'
import { type DeliverJob } from '../events/domain-events.service.js'
import { MailService, type SendJob } from '../mail/mail.service.js'
import { QUEUES } from '../queues/queues.module.js'
import { UnitOfWork } from '../tenancy/unit-of-work.js'
import { Tenant } from '../tenants/tenant.entity.js'
import { WebhooksService } from '../webhooks/webhooks.service.js'

/** Whether BullMQ will try this job again after the current attempt fails. */
function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
}

abstract class LoggingWorker extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name)

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.warn(
      { jobId: job?.id, name: job?.name, attempt: job?.attemptsMade, err: error.message },
      'job failed',
    )
  }
}

@Processor(QUEUES.documents, { concurrency: 4 })
export class DocumentsProcessor extends LoggingWorker {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly documents: DocumentsService,
  ) {
    super()
  }

  async process(job: Job<RenderJob>): Promise<void> {
    const { tenantId, kind, subjectId } = job.data
    await this.uow.run(tenantId, async () => {
      await this.documents.getOrRender(kind, subjectId)
    })
  }
}

@Processor(QUEUES.mail, { concurrency: 8 })
export class MailProcessor extends LoggingWorker {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly mail: MailService,
  ) {
    super()
  }

  async process(job: Job<SendJob>): Promise<void> {
    const outcome = await this.uow.run(job.data.tenantId, () =>
      this.mail.send(job.data.outboxId, isFinalAttempt(job)),
    )
    if (!outcome.ok) throw new Error(outcome.error)
  }
}

@Processor(QUEUES.webhooks, { concurrency: 8 })
export class WebhooksProcessor extends LoggingWorker {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly webhooks: WebhooksService,
  ) {
    super()
  }

  async process(job: Job<DeliverJob>): Promise<void> {
    const outcome = await this.uow.run(job.data.tenantId, () =>
      this.webhooks.deliver(job.data.deliveryId, isFinalAttempt(job)),
    )
    if (!outcome.ok) throw new Error(outcome.error)
  }
}

@Processor(QUEUES.bankImports, { concurrency: 2 })
export class BankImportsProcessor extends LoggingWorker {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly imports: BankImportsService,
  ) {
    super()
  }

  async process(job: Job<ReconcileJob>): Promise<void> {
    const { tenantId, importId } = job.data
    try {
      await this.uow.run(tenantId, () => this.imports.reconcile(importId))
    } catch (error) {
      if (isFinalAttempt(job)) {
        await this.uow.run(tenantId, () =>
          this.imports.markFailed(importId, error instanceof Error ? error.message : String(error)),
        )
      }
      throw error
    }
  }
}

export interface ScanTenantJob {
  tenantId: string
  asOf?: string
}

/**
 * The daily scan fans out: one `scan-all` job lists the tenants and enqueues
 * a `scan-tenant` job for each, so a slow tenant never delays the others and
 * a failure retries for one tenant only.
 */
@Processor(QUEUES.dunning, { concurrency: 4 })
export class DunningProcessor extends LoggingWorker {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly dunning: DunningService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(QUEUES.dunning) private readonly queue: Queue<ScanTenantJob>,
  ) {
    super()
  }

  async process(job: Job<ScanTenantJob>): Promise<unknown> {
    if (job.name === 'scan-all') {
      const tenants = await this.dataSource.manager.find(Tenant, { select: { id: true } })
      const asOf = job.data.asOf
      await this.queue.addBulk(
        tenants.map((tenant) => ({
          name: 'scan-tenant',
          data: { tenantId: tenant.id, asOf },
          opts: {
            jobId: `dunning-${tenant.id}-${asOf ?? new Date().toISOString().slice(0, 10)}`,
            attempts: 3,
          },
        })),
      )
      return { tenants: tenants.length }
    }
    return this.uow.run(job.data.tenantId, () => this.dunning.run(job.data.asOf))
  }
}
