import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export const DOCUMENT_KINDS = ['invoice', 'dunning_notice'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

/**
 * Rendered PDFs, stored in the database. At the volumes a demo sees, bytea is
 * simpler than an object store and transactional with the row it belongs to;
 * the service that reads and writes here is the one place to swap that.
 */
@Entity({ name: 'documents' })
@Index(['tenantId', 'kind', 'subjectId'], { unique: true })
export class StoredDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string

  @Column({ type: 'text' })
  kind: DocumentKind

  /** The invoice or notice this document renders. */
  @Column({ name: 'subject_id', type: 'uuid' })
  subjectId: string

  @Column({ name: 'file_name', type: 'text' })
  fileName: string

  @Column({ name: 'content_type', type: 'text' })
  contentType: string

  @Column({ type: 'bytea' })
  body: Buffer

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes: number

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
