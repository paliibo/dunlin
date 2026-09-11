import { randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { NotFoundError } from '../common/errors.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import type {
  CreateWebhookEndpointDto,
  WebhookDeliveryResponse,
  WebhookEndpointResponse,
} from './dto/webhook.dto.js'
import { signatureHeader } from './signer.js'
import { WebhookDelivery, WebhookEndpoint } from './webhook.entity.js'

export type DeliveryOutcome = { ok: true } | { ok: false; error: string }

export function toEndpointResponse(endpoint: WebhookEndpoint): WebhookEndpointResponse {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    active: endpoint.active,
    createdAt: endpoint.createdAt.toISOString(),
  }
}

export function toDeliveryResponse(delivery: WebhookDelivery): WebhookDeliveryResponse {
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    payload: delivery.payload,
    status: delivery.status,
    attempts: delivery.attempts,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
  }
}

const DELIVERY_TIMEOUT_MS = 10_000

@Injectable()
export class WebhooksService {
  constructor(private readonly ctx: TenantContext) {}

  async create(dto: CreateWebhookEndpointDto): Promise<WebhookEndpoint> {
    const repo = this.ctx.repo(WebhookEndpoint)
    return repo.save(
      repo.create({
        tenantId: this.ctx.tenantId,
        url: dto.url,
        secret: `whsec_${randomBytes(24).toString('base64url')}`,
        events: [...new Set(dto.events)],
        active: true,
      }),
    )
  }

  async list(): Promise<WebhookEndpoint[]> {
    return this.ctx.repo(WebhookEndpoint).find({ order: { createdAt: 'ASC' } })
  }

  async get(id: string): Promise<WebhookEndpoint> {
    const endpoint = await this.ctx.repo(WebhookEndpoint).findOneBy({ id })
    if (!endpoint) throw new NotFoundError('Webhook endpoint', id)
    return endpoint
  }

  async remove(id: string): Promise<void> {
    await this.ctx.repo(WebhookEndpoint).remove(await this.get(id))
  }

  async deliveries(endpointId: string): Promise<WebhookDelivery[]> {
    await this.get(endpointId)
    return this.ctx
      .repo(WebhookDelivery)
      .find({ where: { endpointId }, order: { createdAt: 'DESC' }, take: 100 })
  }

  /**
   * One attempt. The outcome is recorded either way and never thrown, so the
   * transaction that records it commits; the processor decides whether to
   * make BullMQ retry.
   */
  async deliver(deliveryId: string, finalAttempt: boolean): Promise<DeliveryOutcome> {
    const repo = this.ctx.repo(WebhookDelivery)
    const delivery = await repo.findOneBy({ id: deliveryId })
    if (!delivery || delivery.status === 'delivered') return { ok: true }
    const endpoint = await this.ctx.repo(WebhookEndpoint).findOneBy({ id: delivery.endpointId })
    if (!endpoint || !endpoint.active) {
      delivery.status = 'failed'
      delivery.lastError = 'endpoint removed or inactive'
      await repo.save(delivery)
      return { ok: true }
    }

    const body = JSON.stringify(delivery.payload)
    const timestamp = Math.floor(Date.now() / 1000)
    delivery.attempts += 1
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Dunlin-Webhooks/1.0',
          'x-dunlin-event': delivery.eventType,
          'x-dunlin-delivery': delivery.id,
          'x-dunlin-signature': signatureHeader(endpoint.secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      })
      delivery.lastStatusCode = response.status
      if (response.ok) {
        delivery.status = 'delivered'
        delivery.deliveredAt = new Date()
        delivery.lastError = null
        await repo.save(delivery)
        return { ok: true }
      }
      delivery.lastError = `HTTP ${response.status}`
    } catch (error) {
      delivery.lastStatusCode = null
      delivery.lastError = error instanceof Error ? error.message : String(error)
    }
    delivery.status = finalAttempt ? 'failed' : 'pending'
    await repo.save(delivery)
    return { ok: false, error: delivery.lastError ?? 'delivery failed' }
  }
}
