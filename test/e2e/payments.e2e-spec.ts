import { type TenantFixture, TestApp } from '../helpers/test-app.js'

describe('payments and bank reconciliation', () => {
  let t: TestApp
  let acme: TenantFixture
  let customerId: string

  beforeAll(async () => {
    t = await TestApp.start()
    acme = await t.createTenant()
    customerId = (await t.createCustomer(acme.key)).id
  })

  afterAll(async () => {
    await t.close()
  })

  const auth = () => ({ Authorization: `Bearer ${acme.key}` })
  const pay = (invoiceId: string, amountMinor: number, extra: Record<string, unknown> = {}) =>
    t.http
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set(auth())
      .send({ amountMinor, receivedOn: '2026-09-20', method: 'bank_transfer', ...extra })

  it('applies partial and then full payments', async () => {
    const invoice = await t.issueInvoice(acme.key, (await t.createInvoice(acme.key, customerId)).id)
    const partial = await pay(invoice.id, 1_000).expect(201)
    expect(partial.body).toMatchObject({
      amountMinor: 1_000,
      invoiceStatus: 'partially_paid',
      invoiceBalanceMinor: 5_403,
    })

    const rest = await pay(invoice.id, 5_403, { reference: 'final' }).expect(201)
    expect(rest.body).toMatchObject({ invoiceStatus: 'paid', invoiceBalanceMinor: 0 })

    const after = await t.http.get(`/v1/invoices/${invoice.id}`).set(auth()).expect(200)
    expect(after.body).toMatchObject({
      status: 'paid',
      paidMinor: 6_403,
      balanceMinor: 0,
      overdue: false,
    })
    const list = await t.http.get(`/v1/invoices/${invoice.id}/payments`).set(auth()).expect(200)
    expect(list.body.map((p: { amountMinor: number }) => p.amountMinor)).toEqual([1_000, 5_403])
  })

  it('refuses overpayment, payments on closed invoices, and voiding paid invoices', async () => {
    const invoice = await t.issueInvoice(acme.key, (await t.createInvoice(acme.key, customerId)).id)
    const over = await pay(invoice.id, 6_404).expect(422)
    expect(over.body.error).toMatchObject({ code: 'overpayment', details: { balanceMinor: 6_403 } })

    await pay(invoice.id, 6_403).expect(201)
    const closed = await pay(invoice.id, 1).expect(409)
    expect(closed.body.error.code).toBe('invoice_not_open')
    const voidPaid = await t.http
      .post(`/v1/invoices/${invoice.id}/void`)
      .set(auth())
      .send({})
      .expect(409)
    expect(voidPaid.body.error.code).toBe('invoice_has_payments')

    const draft = await t.createInvoice(acme.key, customerId)
    await pay(draft.id, 1).expect(409)
  })

  it('reconciles a bank statement in the background', async () => {
    const beispiel = await t.createCustomer(acme.key, { name: 'Beispiel AG', email: undefined })
    const byReference = await t.issueInvoice(
      acme.key,
      (await t.createInvoice(acme.key, customerId)).id,
    )
    const byAmount = await t.issueInvoice(
      acme.key,
      (
        await t.createInvoice(acme.key, beispiel.id, [
          { description: 'Audit', quantity: 1, unitPriceMinor: 10_000, taxRateBps: 0 },
        ])
      ).id,
    )

    const submitted = await t.http
      .post('/v1/bank-imports')
      .set(auth())
      .set('Idempotency-Key', 'statement-1')
      .send({
        sourceName: 'camt.053 2026-09-21',
        lines: [
          {
            bookedOn: '2026-09-21',
            amountMinor: 6_403,
            currency: 'CHF',
            counterparty: 'MUSTER GMBH',
            reference: `Zahlung ${byReference.number}`,
          },
          {
            bookedOn: '2026-09-21',
            amountMinor: 10_000,
            currency: 'CHF',
            counterparty: 'BEISPIEL AG',
          },
          {
            bookedOn: '2026-09-21',
            amountMinor: 999,
            currency: 'CHF',
            counterparty: 'Unknown Ltd',
            reference: 'no idea',
          },
          {
            bookedOn: '2026-09-21',
            amountMinor: -5_000,
            currency: 'CHF',
            counterparty: 'Landlord',
            reference: 'rent',
          },
        ],
      })
      .expect(202)
    expect(submitted.body).toMatchObject({ status: 'queued', lineCount: 4 })

    const completed = await t.waitFor(
      async () => {
        const response = await t.http
          .get(`/v1/bank-imports/${submitted.body.id}`)
          .set(auth())
          .expect(200)
        return response.body.status === 'completed' ? response.body : null
      },
      { label: 'bank import to complete' },
    )
    expect(completed).toMatchObject({ matchedCount: 2, unmatchedCount: 2 })
    expect(
      completed.lines.map((l: { status: string; reason: string }) => [l.status, l.reason]),
    ).toEqual([
      ['matched', 'reference'],
      ['matched', 'amount_and_counterparty'],
      ['unmatched', 'no_match'],
      ['unmatched', 'not_a_credit'],
    ])

    const paidByRef = await t.http.get(`/v1/invoices/${byReference.id}`).set(auth()).expect(200)
    expect(paidByRef.body.status).toBe('paid')
    const paidByAmount = await t.http.get(`/v1/invoices/${byAmount.id}`).set(auth()).expect(200)
    expect(paidByAmount.body.status).toBe('paid')
    const payments = await t.http
      .get(`/v1/invoices/${byReference.id}/payments`)
      .set(auth())
      .expect(200)
    expect(payments.body[0]).toMatchObject({
      source: 'bank_import',
      bankImportLineId: completed.lines[0].id,
      method: 'bank_transfer',
    })

    const replay = await t.http
      .post('/v1/bank-imports')
      .set(auth())
      .set('Idempotency-Key', 'statement-1')
      .send({
        sourceName: 'camt.053 2026-09-21',
        lines: [{ bookedOn: '2026-09-21', amountMinor: 1, currency: 'CHF' }],
      })
      .expect(422)
    expect(replay.body.error.code).toBe('idempotency_key_reused')
  })
})
