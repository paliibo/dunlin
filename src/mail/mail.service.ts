import { InjectQueue } from '@nestjs/bullmq'
import { Inject, Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { Transporter } from 'nodemailer'

import { ENV, type Env } from '../config/env.js'
import { QUEUES } from '../queues/queues.module.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { OutboxMessage } from './outbox.entity.js'
import { MAIL_TRANSPORT } from './transport.js'

export interface SendJob {
  tenantId: string
  outboxId: string
}

export interface QueuedMail {
  to: string
  subject: string
  text: string
  template: string
  subjectId?: string
}

/** Writes the outbox row now and enqueues the send once the transaction commits. */
@Injectable()
export class MailService {
  constructor(
    private readonly ctx: TenantContext,
    @InjectQueue(QUEUES.mail) private readonly queue: Queue<SendJob>,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAIL_TRANSPORT) private readonly transport: Transporter,
  ) {}

  async queueMessage(input: QueuedMail): Promise<OutboxMessage> {
    const repo = this.ctx.repo(OutboxMessage)
    const message = await repo.save(
      repo.create({
        tenantId: this.ctx.tenantId,
        toEmail: input.to,
        subject: input.subject,
        textBody: input.text,
        template: input.template,
        subjectId: input.subjectId ?? null,
        status: 'queued',
      }),
    )
    this.ctx.afterCommit(() => this.enqueue(message))
    return message
  }

  async enqueue(message: Pick<OutboxMessage, 'id' | 'tenantId'>): Promise<void> {
    await this.queue.add(
      'send',
      { tenantId: message.tenantId, outboxId: message.id },
      {
        jobId: `outbox-${message.id}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: this.env.MAIL_BACKOFF_MS },
      },
    )
  }

  /**
   * One attempt at sending an outbox row. Never throws: the outcome is written
   * and committed either way, and the processor turns `ok: false` into a retry.
   */
  async send(
    outboxId: string,
    finalAttempt: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const repo = this.ctx.repo(OutboxMessage)
    const message = await repo.findOneBy({ id: outboxId })
    if (!message || message.status === 'sent') return { ok: true }

    message.attempts += 1
    try {
      const info = (await this.transport.sendMail({
        from: this.env.MAIL_FROM,
        to: message.toEmail,
        subject: message.subject,
        text: message.textBody,
      })) as { messageId?: string }
      message.status = 'sent'
      message.messageId = info.messageId ?? null
      message.sentAt = new Date()
      message.lastError = null
      await repo.save(message)
      return { ok: true }
    } catch (error) {
      message.lastError = error instanceof Error ? error.message : String(error)
      message.status = finalAttempt ? 'failed' : 'queued'
      await repo.save(message)
      return { ok: false, error: message.lastError }
    }
  }

  async list(status?: OutboxMessage['status']): Promise<OutboxMessage[]> {
    return this.ctx.repo(OutboxMessage).find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
      take: 100,
    })
  }
}
