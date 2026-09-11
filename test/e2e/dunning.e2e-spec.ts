import { getQueueToken } from '@nestjs/bullmq'
import type { Queue } from 'bullmq'

import { type TenantFixture, TestApp } from '../helpers/test-app.js'

describe('dunning', () => {
  let t: TestApp
  let acme: TenantFixture
  let customerId: string

  beforeAll(async () => {
    t = await TestApp.start()
    acme = await t.createTenant({ paymentTermsDays: 14 })
    customerId = (await t.createCustomer(acme.key)).id
  })

  afterAll(async () => {
    await t.close()
  })

  const auth = () => ({ Authorization: `Bearer ${acme.key}` })
  const thousand = [
    { description: 'Retainer', quantity: 1, unitPriceMinor: 100_000, taxRateBps: 0 },
  ]
  const run = (asOf: string) =>
    t.http.post('/v1/dunning/runs').set(auth()).send({ asOf }).expect(200)

  it('escalates one level per run, with the fee and pro-rata interest of that level', async () => {
    const invoice = await t.issueInvoice(
      acme.key,
      (await t.createInvoice(acme.key, customerId, thousand)).id,
      '2026-09-01',
    )
    expect(invoice.dueOn).toBe('2026-09-15')

    const early = await run('2026-09-17')
    expect(early.body).toMatchObject({ asOf: '2026-09-17', considered: 1, escalated: [] })

    const first = await run('2026-09-18')
    expect(first.body.escalated).toEqual([
      expect.objectContaining({
        invoiceId: invoice.id,
        level: 1,
        daysOverdue: 3,
        feeMinor: 0,
        interestMinor: 41,
      }),
    ])
    const afterFirst = await t.http.get(`/v1/invoices/${invoice.id}`).set(auth()).expect(200)
    expect(afterFirst.body.dunning).toEqual({
      level: 1,
      paused: false,
      lastNoticeOn: '2026-09-18',
      feesMinor: 0,
      interestMinor: 41,
      collectibleMinor: 100_041,
    })

    const sameDay = await run('2026-09-18')
    expect(sameDay.body.escalated).toEqual([])

    const second = await run('2026-09-29')
    expect(second.body.escalated).toEqual([
      expect.objectContaining({ level: 2, daysOverdue: 14, feeMinor: 1_500, interestMinor: 192 }),
    ])
    const afterSecond = await t.http.get(`/v1/invoices/${invoice.id}`).set(auth()).expect(200)
    expect(afterSecond.body.dunning).toMatchObject({
      level: 2,
      feesMinor: 1_500,
      interestMinor: 192,
      collectibleMinor: 101_692,
    })

    const notices = await t.http.get(`/v1/invoices/${invoice.id}/dunning`).set(auth()).expect(200)
    expect(
      notices.body.map((n: { level: number; template: string; respondBy: string }) => [
        n.level,
        n.template,
        n.respondBy,
      ]),
    ).toEqual([
      [1, 'reminder', '2026-09-28'],
      [2, 'second_reminder', '2026-10-09'],
    ])

    const letter = await t.http
      .get(`/v1/dunning/notices/${notices.body[1].id}/pdf`)
      .set(auth())
      .expect(200)
    expect(letter.body.subarray(0, 5).toString()).toBe('%PDF-')

    const mails = await t.waitFor(
      async () => {
        const outbox = await t.http.get('/v1/mail/outbox?status=sent').set(auth()).expect(200)
        const reminders = outbox.body.filter((m: { template: string }) =>
          m.template.startsWith('dunning_'),
        )
        return reminders.length === 2 ? reminders : null
      },
      { label: 'both reminder mails to be sent' },
    )
    expect(mails.map((m: { template: string }) => m.template).sort()).toEqual([
      'dunning_reminder',
      'dunning_second_reminder',
    ])
  })

  it('respects pauses and stops after the final level', async () => {
    const invoice = await t.issueInvoice(
      acme.key,
      (await t.createInvoice(acme.key, customerId, thousand)).id,
      '2026-01-01',
    )
    await run('2026-03-01')
    await t.http.post(`/v1/invoices/${invoice.id}/dunning/pause`).set(auth()).expect(200)
    const paused = await run('2026-04-01')
    expect(
      paused.body.escalated.find((e: { invoiceId: string }) => e.invoiceId === invoice.id),
    ).toBeUndefined()

    await t.http.post(`/v1/invoices/${invoice.id}/dunning/resume`).set(auth()).expect(200)
    const resumed = await run('2026-04-01')
    expect(
      resumed.body.escalated.find((e: { invoiceId: string }) => e.invoiceId === invoice.id),
    ).toMatchObject({ level: 2 })
    const final = await run('2026-05-01')
    expect(
      final.body.escalated.find((e: { invoiceId: string }) => e.invoiceId === invoice.id),
    ).toMatchObject({ level: 3, feeMinor: 4_000 })
    const beyond = await run('2026-06-01')
    expect(
      beyond.body.escalated.find((e: { invoiceId: string }) => e.invoiceId === invoice.id),
    ).toBeUndefined()
  })

  it('never chases a settled invoice', async () => {
    const invoice = await t.issueInvoice(
      acme.key,
      (await t.createInvoice(acme.key, customerId, thousand)).id,
      '2025-01-01',
    )
    await t.http
      .post(`/v1/invoices/${invoice.id}/payments`)
      .set(auth())
      .send({ amountMinor: 100_000, receivedOn: '2025-01-10', method: 'card' })
      .expect(201)
    const result = await run('2025-03-01')
    expect(
      result.body.escalated.find((e: { invoiceId: string }) => e.invoiceId === invoice.id),
    ).toBeUndefined()
  })

  it('runs the scheduled scan through the worker, fanned out per tenant', async () => {
    const other = await t.createTenant({ name: 'Other AG' })
    const otherCustomer = await t.createCustomer(other.key, { email: undefined })
    const invoice = await t.issueInvoice(
      other.key,
      (await t.createInvoice(other.key, otherCustomer.id, thousand)).id,
      '2026-01-01',
    )

    const queue = t.app.get<Queue>(getQueueToken('dunning'))
    await queue.add('scan-all', { asOf: '2026-02-01' })

    const dunned = await t.waitFor(
      async () => {
        const response = await t.http
          .get(`/v1/invoices/${invoice.id}`)
          .set({ Authorization: `Bearer ${other.key}` })
          .expect(200)
        return response.body.dunning.level === 1 ? response.body : null
      },
      { label: 'worker to dun the invoice' },
    )
    expect(dunned.dunning.lastNoticeOn).toBe('2026-02-01')
  })
})
