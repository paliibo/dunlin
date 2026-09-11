import { InjectQueue } from '@nestjs/bullmq'
import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common'
import { Queue } from 'bullmq'

import { BankImportsModule } from '../bank-imports/bank-imports.module.js'
import { ENV, type Env } from '../config/env.js'
import { DunningModule } from '../dunning/dunning.module.js'
import { QUEUES } from '../queues/queues.module.js'
import { WebhooksModule } from '../webhooks/webhooks.module.js'
import {
  BankImportsProcessor,
  DocumentsProcessor,
  DunningProcessor,
  MailProcessor,
  WebhooksProcessor,
} from './processors.js'
import { Sweeper, SweeperProcessor } from './sweeper.js'

/** Registers the daily dunning scan. Idempotent: the scheduler id is fixed, so a restart updates rather than duplicates. */
@Injectable()
class DunningScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DunningScheduler.name)

  constructor(
    @InjectQueue(QUEUES.dunning) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'dunning-daily',
      { pattern: this.env.DUNNING_CRON, tz: 'UTC' },
      { name: 'scan-all', data: {} },
    )
    this.logger.log(`Dunning scan scheduled: ${this.env.DUNNING_CRON} UTC`)
  }
}

/**
 * Everything that consumes a queue. Imported by the worker and `all` roles,
 * left out of the API role, so a pure API process never competes for jobs.
 */
@Module({
  imports: [BankImportsModule, DunningModule, WebhooksModule],
  providers: [
    DocumentsProcessor,
    MailProcessor,
    WebhooksProcessor,
    BankImportsProcessor,
    DunningProcessor,
    Sweeper,
    SweeperProcessor,
    DunningScheduler,
  ],
})
export class WorkersModule {}
