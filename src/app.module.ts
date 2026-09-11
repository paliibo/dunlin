import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

import { AuthModule } from './auth/auth.module.js'
import { BankImportsModule } from './bank-imports/bank-imports.module.js'
import { CommonModule } from './common/common.module.js'
import { HttpErrorFilter } from './common/http-error.filter.js'
import { ConfigModule } from './config/config.module.js'
import type { Env } from './config/env.js'
import { CustomersModule } from './customers/customers.module.js'
import { DatabaseModule } from './database/database.module.js'
import { DocumentsModule } from './documents/documents.module.js'
import { DunningModule } from './dunning/dunning.module.js'
import { EventsModule } from './events/events.module.js'
import { HealthModule } from './health/health.module.js'
import { IdempotencyModule } from './idempotency/idempotency.module.js'
import { InvoicesModule } from './invoices/invoices.module.js'
import { MailModule } from './mail/mail.module.js'
import { PaymentsModule } from './payments/payments.module.js'
import { QueuesModule } from './queues/queues.module.js'
import { TenancyModule } from './tenancy/tenancy.module.js'
import { TenantsModule } from './tenants/tenants.module.js'
import { WebhooksModule } from './webhooks/webhooks.module.js'
import { WorkersModule } from './workers/workers.module.js'

/**
 * One module graph, two shapes: the API role serves HTTP and never touches a
 * queue processor; the worker role runs processors and never listens. `all`
 * is both, which is what local development and the test suite use.
 */
@Module({})
export class AppModule {
  static forRole(role: Env['DUNLIN_ROLE']): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule,
        CommonModule,
        DatabaseModule,
        TenancyModule,
        AuthModule,
        QueuesModule,
        EventsModule,
        HealthModule,
        TenantsModule,
        CustomersModule,
        InvoicesModule,
        PaymentsModule,
        BankImportsModule,
        DunningModule,
        DocumentsModule,
        MailModule,
        WebhooksModule,
        IdempotencyModule,
        ...(role === 'api' ? [] : [WorkersModule]),
      ],
      providers: [{ provide: APP_FILTER, useClass: HttpErrorFilter }],
    }
  }
}
