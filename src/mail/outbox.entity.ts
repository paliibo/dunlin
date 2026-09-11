import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export const OUTBOX_STATUSES = ['queued', 'sent', 'failed'] as const
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number]

/**
 * Every message is a row before it is a job. The row is written in the same
 * transaction as whatever caused it, the job is enqueued after commit, and a
 * sweeper re-enqueues rows the process died on in between — so a message is
 * never sent for a change that rolled back, and never lost for one that did
 * not.
 */
@Entity({ name: 'mail_outbox' })
@Index(['tenantId', 'status'])
export class OutboxMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ name: 'to_email', type: 'text' })
  toEmail: string

  @Column({ type: 'text' })
  subject: string

  @Column({ name: 'text_body', type: 'text' })
  textBody: string

  @Column({ type: 'text' })
  template: string

  /** The invoice or notice the message is about, for tracing. */
  @Column({ name: 'subject_id', type: 'uuid', nullable: true })
  subjectId: string | null

  @Column({ type: 'text', default: 'queued' })
  status: OutboxStatus

  @Column({ type: 'int', default: 0 })
  attempts: number

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null

  @Column({ name: 'message_id', type: 'text', nullable: true })
  messageId: string | null

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
