import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export interface PostalAddress {
  line1: string
  line2?: string
  postalCode: string
  city: string
  /** ISO 3166-1 alpha-2. */
  country: string
}

@Entity({ name: 'customers' })
@Index(['tenantId', 'name'])
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ type: 'text' })
  name: string

  @Column({ type: 'text', nullable: true })
  email: string | null

  @Column({ type: 'jsonb', nullable: true })
  address: PostalAddress | null

  @Column({ name: 'vat_id', type: 'text', nullable: true })
  vatId: string | null

  /** Overrides the tenant default when set. */
  @Column({ name: 'payment_terms_days', type: 'int', nullable: true })
  paymentTermsDays: number | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date
}
