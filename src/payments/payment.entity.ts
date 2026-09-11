import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

import type { IsoDate } from '../common/dates.js'
import { bigintToNumber } from '../database/columns.js'

export const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_SOURCES = ['manual', 'bank_import'] as const
export type PaymentSource = (typeof PAYMENT_SOURCES)[number]

/**
 * A payment is applied to exactly one invoice for at most its open balance.
 * Overpayments and unapplied cash are rejected rather than modelled — see
 * docs/decisions.md.
 */
@Entity({ name: 'payments' })
@Index(['tenantId', 'invoiceId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintToNumber })
  amountMinor: number

  @Column({ type: 'char', length: 3 })
  currency: string

  @Column({ name: 'received_on', type: 'date' })
  receivedOn: IsoDate

  @Column({ type: 'text' })
  method: PaymentMethod

  @Column({ type: 'text', nullable: true })
  reference: string | null

  @Column({ type: 'text' })
  source: PaymentSource

  @Column({ name: 'bank_import_line_id', type: 'uuid', nullable: true })
  bankImportLineId: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
