import { randomUUID } from 'node:crypto'

import { InjectQueue } from '@nestjs/bullmq'
import { Inject, Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'

import { ENV, type Env } from '../config/env.js'
import { QUEUES } from '../queues/queues.module.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { WebhookDelivery, WebhookEndpoint, type WebhookEvent } from '../webhooks/webhook.entity.js'

export interface DeliverJob {
  tenantId: string
  deliveryId: string
}

/**
 * Domain events exist to be delivered to webhooks; nothing inside the service
 * subscribes to them. Deliveries are written as rows inside the caller's
 * transaction and enqueued after it commits, so a rolled-back invoice never
 * announces itself and a committed one is never forgotten.
 */
@Injectable()
export class DomainEvents {
  constructor(
    private readonly ctx: TenantContext,
    @InjectQueue(QUEUES.webhooks) private readonly queue: Queue<DeliverJob>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async emit(type: WebhookEvent, data: Record<string, unknown>): Promise<void> {
    const endpoints = (await this.ctx.repo(WebhookEndpoint).findBy({ active: true })).filter(
      (endpoint) => endpoint.events.includes('*') || endpoint.events.includes(type),
    )
    if (endpoints.length === 0) return

    const tenantId = this.ctx.tenantId
    const payload = { id: randomUUID(), type, occurredAt: new Date().toISOString(), tenantId, data }
    const repo = this.ctx.repo(WebhookDelivery)
    const deliveries = await repo.save(
      endpoints.map((endpoint) =>
        repo.create({
          tenantId,
          endpointId: endpoint.id,
          eventId: payload.id,
          eventType: type,
          payload,
        }),
      ),
    )

    this.ctx.afterCommit(() => this.enqueue(deliveries))
  }

  async enqueue(deliveries: WebhookDelivery[]): Promise<void> {
    await this.queue.addBulk(
      deliveries.map((delivery) => ({
        name: 'deliver',
        data: { tenantId: delivery.tenantId, deliveryId: delivery.id },
        opts: {
          jobId: `delivery-${delivery.id}`,
          attempts: 6,
          backoff: { type: 'exponential', delay: this.env.WEBHOOK_BACKOFF_MS },
        },
      })),
    )
  }
}
