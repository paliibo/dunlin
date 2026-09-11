import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export const ROLES = ['owner', 'accountant', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/**
 * API keys are the only credential. The plaintext is shown once, at creation;
 * what is stored is a SHA-256 of it, which is enough for a 192-bit random key
 * — there is nothing for a slow hash to defend against.
 *
 * Platform-level, like tenants: the key is what tells us which tenant a
 * request belongs to, so it is looked up before any tenant scope exists.
 */
@Entity({ name: 'api_keys' })
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ type: 'text' })
  name: string

  @Column({ type: 'text' })
  role: Role

  /** The first characters of the key, so a list can identify it without revealing it. */
  @Column({ name: 'key_prefix', type: 'text' })
  keyPrefix: string

  @Column({ name: 'key_hash', type: 'text', unique: true })
  keyHash: string

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null
}
