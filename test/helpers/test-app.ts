import { randomUUID } from 'node:crypto'

import { getQueueToken } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getDataSourceToken } from '@nestjs/typeorm'
import type { Queue } from 'bullmq'
import request from 'supertest'
import type { DataSource } from 'typeorm'

import { AppModule } from '../../src/app.module.js'
import { configureApp } from '../../src/app.setup.js'
import { QUEUES } from '../../src/queues/queues.module.js'

export interface TenantFixture {
  tenantId: string
  key: string
  name: string
  currency: string
}

export interface LineInput {
  description: string
  quantity: number
  unitPriceMinor: number
  taxRateBps: number
}

export const DEFAULT_LINES: LineInput[] = [
  { description: 'Consulting', quantity: 2, unitPriceMinor: 1_999, taxRateBps: 2_000 },
  { description: 'Travel', quantity: 1.5, unitPriceMinor: 1_000, taxRateBps: 700 },
]

/**
 * The whole application, against the real Postgres and Redis from compose.yaml.
 * Every suite starts from an empty database and its own queue prefix, so
 * suites cannot see each other's rows or jobs.
 */
export class TestApp {
  readonly platformToken = process.env.PLATFORM_TOKEN as string

  private constructor(
    readonly app: INestApplication,
    readonly dataSource: DataSource,
  ) {}

  static async start(): Promise<TestApp> {
    process.env.QUEUE_PREFIX = `dunlin-test-${randomUUID().slice(0, 8)}`
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRole('all')],
    }).compile()
    const app = moduleRef.createNestApplication({ logger: false })
    configureApp(app)
    await app.init()
    const dataSource = app.get<DataSource>(getDataSourceToken())
    await dataSource.query('truncate table tenants cascade')
    return new TestApp(app, dataSource)
  }

  get http() {
    return request(this.app.getHttpServer())
  }

  async close(): Promise<void> {
    for (const name of Object.values(QUEUES)) {
      const queue = this.app.get<Queue>(getQueueToken(name))
      await queue.obliterate({ force: true }).catch(() => undefined)
    }
    await this.app.close()
  }

  async createTenant(overrides: Record<string, unknown> = {}): Promise<TenantFixture> {
    const response = await this.http
      .post('/v1/tenants')
      .set('x-platform-token', this.platformToken)
      .send({ name: 'Acme Treuhand AG', country: 'CH', currency: 'CHF', ...overrides })
      .expect(201)
    return {
      tenantId: response.body.tenant.id,
      key: response.body.apiKey.key,
      name: response.body.tenant.name,
      currency: response.body.tenant.currency,
    }
  }

  async issueKey(tenantId: string, role: 'owner' | 'accountant' | 'viewer'): Promise<string> {
    const response = await this.http
      .post(`/v1/tenants/${tenantId}/api-keys`)
      .set('x-platform-token', this.platformToken)
      .send({ name: `${role} key`, role })
      .expect(201)
    return response.body.key as string
  }

  async createCustomer(
    key: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const response = await this.http
      .post('/v1/customers')
      .auth(key, { type: 'bearer' })
      .send({
        name: 'Muster GmbH',
        email: 'ap@muster.example',
        address: { line1: 'Bahnhofstrasse 1', postalCode: '8001', city: 'Zürich', country: 'CH' },
        ...overrides,
      })
      .expect(201)
    return response.body
  }

  async createInvoice(
    key: string,
    customerId: string,
    lines: LineInput[] = DEFAULT_LINES,
  ): Promise<Record<string, any>> {
    const response = await this.http
      .post('/v1/invoices')
      .auth(key, { type: 'bearer' })
      .send({ customerId, lines })
      .expect(201)
    return response.body
  }

  async issueInvoice(
    key: string,
    invoiceId: string,
    issuedOn?: string,
  ): Promise<Record<string, any>> {
    const response = await this.http
      .post(`/v1/invoices/${invoiceId}/issue`)
      .auth(key, { type: 'bearer' })
      .send(issuedOn ? { issuedOn } : {})
      .expect(200)
    return response.body
  }

  /** Polls until `probe` returns something truthy; the way to wait for a worker. */
  async waitFor<T>(
    probe: () => Promise<T | null | undefined | false>,
    { timeoutMs = 10_000, intervalMs = 100, label = 'condition' } = {},
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = await probe()
      if (value) return value
      if (Date.now() > deadline)
        throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`)
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
}
