import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

import type { IsoDate } from '../common/dates.js'
import { bigintToNumber } from '../database/columns.js'

export const IMPORT_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

export const LINE_STATUSES = ['pending', 'matched', 'unmatched'] as const
export type LineStatus = (typeof LINE_STATUSES)[number]

/**
 * A batch of bank statement lines handed over for reconciliation. The request
 * only stores the lines; a worker does the matching, so a ten-thousand-line
 * statement does not hold an HTTP connection open.
 */
@Entity({ name: 'bank_imports' })
@Index(['tenantId', 'createdAt', 'id'])
export class BankImport {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ type: 'text' })
  status: ImportStatus

  @Column({ name: 'source_name', type: 'text', nullable: true })
  sourceName: string | null

  @Column({ name: 'line_count', type: 'int' })
  lineCount: number

  @Column({ name: 'matched_count', type: 'int', default: 0 })
  matchedCount: number

  @Column({ name: 'unmatched_count', type: 'int', default: 0 })
  unmatchedCount: number

  @Column({ type: 'text', nullable: true })
  error: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null
}

@Entity({ name: 'bank_import_lines' })
@Index(['importId', 'position'], { unique: true })
export class BankImportLine {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ name: 'import_id', type: 'uuid' })
  importId: string

  @Column({ type: 'int' })
  position: number

  @Column({ name: 'booked_on', type: 'date' })
  bookedOn: IsoDate

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintToNumber })
  amountMinor: number

  @Column({ type: 'char', length: 3 })
  currency: string

  @Column({ type: 'text', nullable: true })
  counterparty: string | null

  @Column({ type: 'text', nullable: true })
  reference: string | null

  @Column({ type: 'text', default: 'pending' })
  status: LineStatus

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null

  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId: string | null

  /** Why it matched (`reference`, `amount_and_counterparty`) or why it did not. */
  @Column({ type: 'text', nullable: true })
  reason: string | null
}
