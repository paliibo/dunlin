import { Column, CreateDateColumn, Entity } from 'typeorm'

/**
 * `Idempotency-Key` bookkeeping. The row is inserted before the handler runs
 * and filled in after, inside the same transaction: a concurrent duplicate
 * blocks on the unique key until the first commits, then sees the response.
 */
@Entity({ name: 'idempotency_keys' })
export class IdempotencyKey {
  @Column({ name: 'tenant_id', type: 'uuid', primary: true })
  tenantId: string

  @Column({ type: 'text', primary: true })
  key: string

  /** SHA-256 of method, path and body: the same key with a different request is an error. */
  @Column({ type: 'text' })
  fingerprint: string

  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode: number | null

  @Column({ type: 'jsonb', nullable: true })
  response: unknown

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
