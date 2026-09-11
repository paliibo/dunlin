import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export const WEBHOOK_EVENTS = [
  'invoice.issued',
  'invoice.paid',
  'invoice.voided',
  'payment.recorded',
  'dunning.notice_created',
  'bank_import.completed',
] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

@Entity({ name: 'webhook_endpoints' })
@Index(['tenantId'])
export class WebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ type: 'text' })
  url: string

  /** Shared secret for the HMAC signature; shown once, at creation. */
  @Column({ type: 'text' })
  secret: string

  /** Event types to deliver; `*` for all. */
  @Column({ type: 'text', array: true })
  events: string[]

  @Column({ type: 'boolean', default: true })
  active: boolean

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}

/**
 * One row per endpoint per event: the payload as sent and the outcome of every
 * attempt. Same outbox discipline as mail — row inside the transaction, job
 * after commit, sweeper for stragglers.
 */
@Entity({ name: 'webhook_deliveries' })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'endpointId', 'createdAt'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ name: 'endpoint_id', type: 'uuid' })
  endpointId: string

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string

  @Column({ name: 'event_type', type: 'text' })
  eventType: string

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>

  @Column({ type: 'text', default: 'pending' })
  status: DeliveryStatus

  @Column({ type: 'int', default: 0 })
  attempts: number

  @Column({ name: 'last_status_code', type: 'int', nullable: true })
  lastStatusCode: number | null

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
