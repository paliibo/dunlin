import { BullModule } from '@nestjs/bullmq'
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common'
import type { ConnectionOptions } from 'bullmq'
import { Redis } from 'ioredis'

import { ENV, type Env } from '../config/env.js'

export const QUEUES = {
  documents: 'documents',
  mail: 'mail',
  webhooks: 'webhooks',
  bankImports: 'bank-imports',
  dunning: 'dunning',
  maintenance: 'maintenance',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export const REDIS = Symbol('REDIS')

/** BullMQ takes ioredis options, not a URL. */
export function redisConnectionOptions(url: string): ConnectionOptions {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // BullMQ's blocking commands must not be cut short by ioredis' default retry cap.
    maxRetriesPerRequest: null,
  }
}

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined)
  }
}

/**
 * One BullMQ connection config and every queue, registered once and shared.
 * Processors live in the workers module so the API role can skip them.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: redisConnectionOptions(env.REDIS_URL),
        prefix: env.QUEUE_PREFIX,
        defaultJobOptions: {
          removeOnComplete: { count: 1_000 },
          removeOnFail: { count: 5_000 },
        },
      }),
    }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true }),
    },
    RedisLifecycle,
  ],
  exports: [BullModule, REDIS],
})
export class QueuesModule {}
