import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

import type { DunningPolicy } from './dunning-policy.js'

/**
 * A tenant is a company that invoices. Everything else hangs off one, and
 * Postgres row-level security keeps each tenant's rows invisible to the rest.
 * This table itself is platform-level: it is read by id, never listed by a
 * tenant.
 */
@Entity({ name: 'tenants' })
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'text' })
  name: string

  /** ISO 3166-1 alpha-2, e.g. CH, DE. */
  @Column({ type: 'char', length: 2 })
  country: string

  /** ISO 4217, e.g. CHF, EUR. Every invoice of the tenant is in this currency. */
  @Column({ type: 'char', length: 3 })
  currency: string

  @Column({ name: 'invoice_prefix', type: 'text', default: 'INV' })
  invoicePrefix: string

  @Column({ name: 'payment_terms_days', type: 'int', default: 14 })
  paymentTermsDays: number

  @Column({ name: 'dunning_policy', type: 'jsonb' })
  dunningPolicy: DunningPolicy

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
