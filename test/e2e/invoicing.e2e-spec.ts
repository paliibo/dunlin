import { DEFAULT_LINES, type TenantFixture, TestApp } from '../helpers/test-app.js'

describe('invoicing', () => {
  let t: TestApp
  let acme: TenantFixture
  let customerId: string

  beforeAll(async () => {
    t = await TestApp.start()
    acme = await t.createTenant({ name: 'Acme Treuhand AG', paymentTermsDays: 14 })
    customerId = (await t.createCustomer(acme.key)).id
  })

  afterAll(async () => {
    await t.close()
  })

  const auth = (key = acme.key) => ({ Authorization: `Bearer ${key}` })

  it('computes totals per line, rounding each line once', async () => {
    const invoice = await t.createInvoice(acme.key, customerId)
    expect(invoice).toMatchObject({
      status: 'draft',
      number: null,
      currency: 'CHF',
      subtotalMinor: 5_498,
      taxMinor: 905,
      totalMinor: 6_403,
      paidMinor: 0,
      balanceMinor: 6_403,
      overdue: false,
    })
    expect(invoice.lines).toEqual([
      expect.objectContaining({
        position: 1,
        quantity: 2,
        netMinor: 3_998,
        taxMinor: 800,
        totalMinor: 4_798,
      }),
      expect.objectContaining({
        position: 2,
        quantity: 1.5,
        netMinor: 1_500,
        taxMinor: 105,
        totalMinor: 1_605,
      }),
    ])
  })

  it('rejects unknown customers and malformed lines', async () => {
    const unknown = await t.http
      .post('/v1/invoices')
      .set(auth())
      .send({ customerId: '3f5c9c2e-1b7a-4f5c-9a5e-0d6b6b7a8c9d', lines: DEFAULT_LINES })
      .expect(422)
    expect(unknown.body.error.code).toBe('unknown_customer')

    const malformed = await t.http
      .post('/v1/invoices')
      .set(auth())
      .send({
        customerId,
        lines: [{ description: 'x', quantity: 1.0001, unitPriceMinor: 10.5, taxRateBps: 10_001 }],
      })
      .expect(422)
    expect(Object.keys(malformed.body.error.details)).toEqual(
      expect.arrayContaining(['lines.0.quantity', 'lines.0.unitPriceMinor', 'lines.0.taxRateBps']),
    )
  })

  it('issues with a gapless per-year number and a due date from the payment terms', async () => {
    const first = await t.issueInvoice(
      acme.key,
      (await t.createInvoice(acme.key, customerId)).id,
      '2026-09-01',
    )
    expect(first).toMatchObject({
      status: 'issued',
      number: 'INV-2026-0001',
      issuedOn: '2026-09-01',
      dueOn: '2026-09-15',
    })

    const second = await t.issueInvoice(
      acme.key,
      (await t.createInvoice(acme.key, customerId)).id,
      '2026-09-02',
    )
    expect(second.number).toBe('INV-2026-0002')

    const nextYear = await t.issueInvoice(
      acme.key,
      (await t.createInvoice(acme.key, customerId)).id,
      '2027-01-04',
    )
    expect(nextYear.number).toBe('INV-2027-0001')

    const again = await t.http
      .post(`/v1/invoices/${first.id}/issue`)
      .set(auth())
      .send({})
      .expect(409)
    expect(again.body.error.code).toBe('invoice_not_draft')
  })

  it('honours a customer-level override of the payment terms', async () => {
    const slow = await t.createCustomer(acme.key, { name: 'Slow Payer AG', paymentTermsDays: 60 })
    const invoice = await t.issueInvoice(
      acme.key,
      (await t.createInvoice(acme.key, slow.id)).id,
      '2026-03-01',
    )
    expect(invoice.dueOn).toBe('2026-04-30')
  })

  it('keeps numbers unique and consecutive under concurrent issuing', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 6 }, () => t.createInvoice(acme.key, customerId)),
    )
    const issued = await Promise.all(
      drafts.map((draft) => t.issueInvoice(acme.key, draft.id, '2028-06-01')),
    )
    const sequence = issued
      .map((invoice) => Number(String(invoice.number).split('-')[2]))
      .sort((a, b) => a - b)
    expect(sequence).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(issued.map((invoice) => invoice.number)).size).toBe(6)
  })

  it('renders the PDF on request and sends the invoice by mail', async () => {
    const invoice = await t.issueInvoice(acme.key, (await t.createInvoice(acme.key, customerId)).id)
    const pdf = await t.http.get(`/v1/invoices/${invoice.id}/pdf`).set(auth()).expect(200)
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/)
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-')

    const sent = await t.waitFor(
      async () => {
        const outbox = await t.http.get('/v1/mail/outbox').set(auth()).expect(200)
        return outbox.body.find(
          (m: { subjectId: string; status: string }) =>
            m.subjectId === invoice.id && m.status === 'sent',
        )
      },
      { label: 'invoice mail to be sent' },
    )
    expect(sent).toMatchObject({ to: 'ap@muster.example', template: 'invoice_issued', attempts: 1 })
    expect(sent.subject).toContain(invoice.number)
  })

  it('has no PDF for a draft', async () => {
    const draft = await t.createInvoice(acme.key, customerId)
    await t.http.get(`/v1/invoices/${draft.id}/pdf`).set(auth()).expect(404)
  })

  it('voids drafts and unpaid invoices, and nothing else twice', async () => {
    const draft = await t.createInvoice(acme.key, customerId)
    const voided = await t.http
      .post(`/v1/invoices/${draft.id}/void`)
      .set(auth())
      .send({ reason: 'typo' })
      .expect(200)
    expect(voided.body).toMatchObject({ status: 'void', voidReason: 'typo' })
    await t.http.post(`/v1/invoices/${draft.id}/issue`).set(auth()).send({}).expect(409)

    const issued = await t.issueInvoice(acme.key, (await t.createInvoice(acme.key, customerId)).id)
    await t.http.post(`/v1/invoices/${issued.id}/void`).set(auth()).send({}).expect(200)
    const twice = await t.http
      .post(`/v1/invoices/${issued.id}/void`)
      .set(auth())
      .send({})
      .expect(200)
    expect(twice.body.status).toBe('void')
  })

  it('lists newest first with cursor pages and filters', async () => {
    const fresh = await t.createTenant({ name: 'Paging AG' })
    const customer = await t.createCustomer(fresh.key)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push((await t.createInvoice(fresh.key, customer.id)).id)
    await t.issueInvoice(fresh.key, ids[0] as string, '2020-01-01')

    const page1 = await t.http.get('/v1/invoices?limit=2').set(auth(fresh.key)).expect(200)
    expect(page1.body.items.map((i: { id: string }) => i.id)).toEqual([ids[2], ids[1]])
    expect(page1.body.nextCursor).toEqual(expect.any(String))
    const page2 = await t.http
      .get(`/v1/invoices?limit=2&cursor=${page1.body.nextCursor}`)
      .set(auth(fresh.key))
      .expect(200)
    expect(page2.body.items.map((i: { id: string }) => i.id)).toEqual([ids[0]])
    expect(page2.body.nextCursor).toBeNull()

    const drafts = await t.http.get('/v1/invoices?status=draft').set(auth(fresh.key)).expect(200)
    expect(drafts.body.items).toHaveLength(2)
    const overdue = await t.http.get('/v1/invoices?overdue=true').set(auth(fresh.key)).expect(200)
    expect(
      overdue.body.items.map((i: { id: string; overdue: boolean }) => [i.id, i.overdue]),
    ).toEqual([[ids[0], true]])

    await t.http.get('/v1/invoices?cursor=garbage').set(auth(fresh.key)).expect(422)
  })

  it('replays an idempotent create and refuses the key for a different body', async () => {
    const body = { customerId, lines: DEFAULT_LINES }
    const first = await t.http
      .post('/v1/invoices')
      .set(auth())
      .set('Idempotency-Key', 'create-1')
      .send(body)
      .expect(201)
    const replay = await t.http
      .post('/v1/invoices')
      .set(auth())
      .set('Idempotency-Key', 'create-1')
      .send(body)
      .expect(201)
    expect(replay.body.id).toBe(first.body.id)
    expect(replay.headers['idempotent-replayed']).toBe('true')

    const reused = await t.http
      .post('/v1/invoices')
      .set(auth())
      .set('Idempotency-Key', 'create-1')
      .send({ ...body, notes: 'different' })
      .expect(422)
    expect(reused.body.error.code).toBe('idempotency_key_reused')

    const all = await t.http
      .get(`/v1/invoices?customerId=${customerId}&status=draft&limit=100`)
      .set(auth())
      .expect(200)
    expect(all.body.items.filter((i: { id: string }) => i.id === first.body.id)).toHaveLength(1)
  })
})
