import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

import type { IsoDate } from '../common/dates.js'
import { bigintToNumber } from '../database/columns.js'
import type { DunningLevel } from '../tenants/dunning-policy.js'

/**
 * One notice per escalation step. The amounts are frozen at the moment the
 * notice is created — a reminder that said "you owe 500" keeps saying so even
 * after a partial payment.
 */
@Entity({ name: 'dunning_notices' })
@Index(['tenantId', 'invoiceId', 'level'], { unique: true })
export class DunningNotice {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string

  /** 1-based: the first reminder is level 1. */
  @Column({ type: 'int' })
  level: number

  @Column({ type: 'text' })
  template: DunningLevel['template']

  @Column({ name: 'issued_on', type: 'date' })
  issuedOn: IsoDate

  /** The date the letter asks for payment by. */
  @Column({ name: 'respond_by', type: 'date' })
  respondBy: IsoDate

  @Column({ name: 'days_overdue', type: 'int' })
  daysOverdue: number

  @Column({ name: 'balance_minor', type: 'bigint', transformer: bigintToNumber })
  balanceMinor: number

  @Column({ name: 'fee_minor', type: 'bigint', transformer: bigintToNumber })
  feeMinor: number

  @Column({ name: 'interest_minor', type: 'bigint', transformer: bigintToNumber })
  interestMinor: number

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
