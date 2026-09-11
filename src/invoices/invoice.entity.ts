import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm'

import type { IsoDate } from '../common/dates.js'
import { Customer } from '../customers/customer.entity.js'
import { bigintToNumber, numericToNumber } from '../database/columns.js'

export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/** Statuses in which money is still expected. */
export const OPEN_STATUSES: readonly InvoiceStatus[] = ['issued', 'partially_paid']

@Entity({ name: 'invoices' })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'customerId'])
@Index(['tenantId', 'dueOn'])
@Index(['tenantId', 'createdAt', 'id'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer: Relation<Customer>

  /** Assigned on issue; drafts have none. Unique per tenant. */
  @Column({ type: 'text', nullable: true })
  number: string | null

  @Column({ type: 'text' })
  status: InvoiceStatus

  @Column({ type: 'char', length: 3 })
  currency: string

  @Column({ name: 'issued_on', type: 'date', nullable: true })
  issuedOn: IsoDate | null

  @Column({ name: 'due_on', type: 'date', nullable: true })
  dueOn: IsoDate | null

  @Column({ name: 'subtotal_minor', type: 'bigint', transformer: bigintToNumber })
  subtotalMinor: number

  @Column({ name: 'tax_minor', type: 'bigint', transformer: bigintToNumber })
  taxMinor: number

  @Column({ name: 'total_minor', type: 'bigint', transformer: bigintToNumber })
  totalMinor: number

  @Column({ name: 'paid_minor', type: 'bigint', transformer: bigintToNumber, default: 0 })
  paidMinor: number

  @Column({ type: 'text', nullable: true })
  notes: string | null

  /** Highest dunning level reached so far; 0 until the first notice. */
  @Column({ name: 'dunning_level', type: 'int', default: 0 })
  dunningLevel: number

  @Column({ name: 'dunning_paused', type: 'boolean', default: false })
  dunningPaused: boolean

  @Column({ name: 'last_dunned_on', type: 'date', nullable: true })
  lastDunnedOn: IsoDate | null

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason: string | null

  @OneToMany(() => InvoiceLine, (line) => line.invoice, { cascade: ['insert'] })
  lines: Relation<InvoiceLine>[]

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date

  get balanceMinor(): number {
    return this.totalMinor - this.paidMinor
  }
}

@Entity({ name: 'invoice_lines' })
@Index(['invoiceId', 'position'], { unique: true })
export class InvoiceLine {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string

  @ManyToOne(() => Invoice, (invoice) => invoice.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Relation<Invoice>

  @Column({ type: 'int' })
  position: number

  @Column({ type: 'text' })
  description: string

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: numericToNumber })
  quantity: number

  @Column({ name: 'unit_price_minor', type: 'bigint', transformer: bigintToNumber })
  unitPriceMinor: number

  @Column({ name: 'tax_rate_bps', type: 'int' })
  taxRateBps: number

  @Column({ name: 'net_minor', type: 'bigint', transformer: bigintToNumber })
  netMinor: number

  @Column({ name: 'tax_minor', type: 'bigint', transformer: bigintToNumber })
  taxMinor: number

  @Column({ name: 'total_minor', type: 'bigint', transformer: bigintToNumber })
  totalMinor: number
}

/**
 * One row per tenant and year: the next sequence number to hand out. Updated
 * with a single `... RETURNING` statement inside the issuing transaction, so
 * concurrent issues queue on the row lock and numbers come out gapless.
 */
@Entity({ name: 'invoice_counters' })
export class InvoiceCounter {
  @Column({ name: 'tenant_id', type: 'uuid', primary: true })
  tenantId: string

  @Column({ type: 'int', primary: true })
  year: number

  @Column({ type: 'int', default: 1 })
  next: number
}
