import { existsSync } from 'node:fs'

import { z } from 'zod'

/**
 * Environment parsing happens once, at boot, so a misconfigured deploy fails
 * loudly before it serves a request rather than somewhere deep in a handler.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DUNLIN_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  QUEUE_PREFIX: z.string().min(1).default('dunlin'),
  DB_MIGRATE_ON_BOOT: z
    .enum(['0', '1'])
    .default('1')
    .transform((value) => value === '1'),
  PLATFORM_TOKEN: z.string().min(16, 'PLATFORM_TOKEN must be at least 16 characters'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Dunlin Billing <billing@dunlin.local>'),
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  DUNNING_CRON: z.string().default('0 6 * * *'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Base delay for job retries. Tests shorten it so a retry finishes inside a test. */
  WEBHOOK_BACKOFF_MS: z.coerce.number().int().positive().default(1_000),
  MAIL_BACKOFF_MS: z.coerce.number().int().positive().default(1_000),
})

export type Env = z.infer<typeof schema>

export const ENV = Symbol('ENV')

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Local convenience only: variables already in the environment win, so a
  // container or CI job that sets everything explicitly never reads the file.
  if (source === process.env && existsSync('.env')) process.loadEnvFile('.env')
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
