import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { verifySignature } from '../../src/webhooks/signer.js'
import { type TenantFixture, TestApp } from '../helpers/test-app.js'

interface Received {
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** A receiver that answers with whatever status codes it was handed, in order, then 200. */
function receiver(
  statuses: number[] = [],
): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = []
  const queue = [...statuses]
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      received.push({ headers: req.headers, body })
      res.writeHead(queue.shift() ?? 200).end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}/hooks/dunlin`, received })
    })
  })
}

describe('webhooks', () => {
  let t: TestApp
  let acme: TenantFixture
  let customerId: string
  const servers: Server[] = []

  beforeAll(async () => {
    t = await TestApp.start()
    acme = await t.createTenant()
    customerId = (await t.createCustomer(acme.key, { email: undefined })).id
  })

  afterAll(async () => {
    for (const server of servers) server.close()
    await t.close()
  })

  const auth = () => ({ Authorization: `Bearer ${acme.key}` })

  async function subscribe(url: string, events: string[]): Promise<{ id: string; secret: string }> {
    const response = await t.http.post('/v1/webhooks').set(auth()).send({ url, events }).expect(201)
    expect(response.body.secret).toMatch(/^whsec_/)
    return response.body
  }

  it('delivers signed events for the subscribed types only', async () => {
    const hook = await receiver()
    servers.push(hook.server)
    const endpoint = await subscribe(hook.url, ['invoice.paid'])

    const invoice = await t.issueInvoice(acme.key, (await t.createInvoice(acme.key, customerId)).id)
    await t.http
      .post(`/v1/invoices/${invoice.id}/payments`)
      .set(auth())
      .send({ amountMinor: 6_403, receivedOn: '2026-09-20', method: 'card' })
      .expect(201)

    const received = await t.waitFor(
      async () => (hook.received.length >= 1 ? hook.received : null),
      { label: 'webhook delivery' },
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(hook.received).toHaveLength(1)

    const [delivery] = received as [Received]
    const payload = JSON.parse(delivery.body)
    expect(payload).toMatchObject({
      type: 'invoice.paid',
      tenantId: acme.tenantId,
      data: { invoiceId: invoice.id, status: 'paid' },
    })
    expect(delivery.headers['x-dunlin-event']).toBe('invoice.paid')
    expect(delivery.headers['content-type']).toBe('application/json')
    expect(
      verifySignature(
        endpoint.secret,
        delivery.headers['x-dunlin-signature'] as string,
        delivery.body,
      ),
    ).toBe(true)
    expect(
      verifySignature(
        'whsec_wrong',
        delivery.headers['x-dunlin-signature'] as string,
        delivery.body,
      ),
    ).toBe(false)

    const deliveries = await t.http
      .get(`/v1/webhooks/${endpoint.id}/deliveries`)
      .set(auth())
      .expect(200)
    expect(deliveries.body).toEqual([
      expect.objectContaining({
        eventType: 'invoice.paid',
        status: 'delivered',
        attempts: 1,
        lastStatusCode: 200,
      }),
    ])
  })

  it('retries a failing endpoint with backoff until it succeeds', async () => {
    const flaky = await receiver([500, 503])
    servers.push(flaky.server)
    const endpoint = await subscribe(flaky.url, ['*'])

    await t.issueInvoice(acme.key, (await t.createInvoice(acme.key, customerId)).id)

    const delivered = await t.waitFor(
      async () => {
        const response = await t.http
          .get(`/v1/webhooks/${endpoint.id}/deliveries`)
          .set(auth())
          .expect(200)
        const done = response.body.find((d: { status: string }) => d.status === 'delivered')
        return done ?? null
      },
      { label: 'retried delivery' },
    )
    expect(delivered).toMatchObject({
      eventType: 'invoice.issued',
      attempts: 3,
      lastStatusCode: 200,
    })
    expect(flaky.received).toHaveLength(3)
  })

  it('gives up after the last attempt and records why', async () => {
    const dead = await receiver([500, 500, 500, 500, 500, 500, 500])
    servers.push(dead.server)
    const endpoint = await subscribe(dead.url, ['invoice.voided'])
    const invoice = await t.createInvoice(acme.key, customerId)
    await t.http.post(`/v1/invoices/${invoice.id}/void`).set(auth()).send({}).expect(200)

    const failed = await t.waitFor(
      async () => {
        const response = await t.http
          .get(`/v1/webhooks/${endpoint.id}/deliveries`)
          .set(auth())
          .expect(200)
        return response.body.find((d: { status: string }) => d.status === 'failed') ?? null
      },
      { label: 'delivery to fail for good', timeoutMs: 20_000 },
    )
    expect(failed).toMatchObject({ attempts: 6, lastStatusCode: 500, lastError: 'HTTP 500' })
  })

  it('is owner-only and removes deliveries with the endpoint', async () => {
    const accountant = await t.issueKey(acme.tenantId, 'accountant')
    await t.http
      .get('/v1/webhooks')
      .set({ Authorization: `Bearer ${accountant}` })
      .expect(403)
    const endpoints = await t.http.get('/v1/webhooks').set(auth()).expect(200)
    expect(endpoints.body.length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(endpoints.body)).not.toContain('whsec_')
    await t.http.delete(`/v1/webhooks/${endpoints.body[0].id}`).set(auth()).expect(204)
    await t.http.get(`/v1/webhooks/${endpoints.body[0].id}/deliveries`).set(auth()).expect(404)
  })
})
