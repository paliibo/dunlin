import { TestApp } from '../helpers/test-app.js'

describe('tenancy and authentication', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await TestApp.start()
  })

  afterAll(async () => {
    await t.close()
  })

  it('serves a public health check with real dependency probes', async () => {
    const response = await t.http.get('/health').expect(200)
    expect(response.body.status).toBe('ok')
    expect(response.body.info.database.status).toBe('up')
    expect(response.body.info.redis.status).toBe('up')
  })

  it('gates tenant creation behind the platform token', async () => {
    const body = { name: 'Nope AG', country: 'CH', currency: 'CHF' }
    await t.http.post('/v1/tenants').send(body).expect(401)
    await t.http.post('/v1/tenants').set('x-platform-token', 'wrong').send(body).expect(401)
    const response = await t.http
      .post('/v1/tenants')
      .set('x-platform-token', t.platformToken)
      .send(body)
      .expect(201)
    expect(response.body.apiKey.key).toMatch(/^dnl_[A-Za-z0-9_-]{32}$/)
    expect(response.body.apiKey.role).toBe('owner')
    expect(response.body.tenant.dunningPolicy.levels).toHaveLength(3)
  })

  it('rejects malformed tenants with field-level detail', async () => {
    const response = await t.http
      .post('/v1/tenants')
      .set('x-platform-token', t.platformToken)
      .send({ name: '', country: 'Switzerland', currency: 'chf', extra: true })
      .expect(422)
    expect(response.body.error.code).toBe('validation_failed')
    expect(Object.keys(response.body.error.details)).toEqual(
      expect.arrayContaining(['name', 'country', 'currency', 'extra']),
    )
  })

  it('authenticates API keys and identifies their tenant', async () => {
    const acme = await t.createTenant({ name: 'Acme Treuhand AG' })
    await t.http.get('/v1/tenant').expect(401)
    await t.http
      .get('/v1/tenant')
      .auth('dnl_not_a_real_key_at_all_0000000000', { type: 'bearer' })
      .expect(401)
    const me = await t.http.get('/v1/tenant').auth(acme.key, { type: 'bearer' }).expect(200)
    expect(me.body).toMatchObject({ id: acme.tenantId, name: 'Acme Treuhand AG', currency: 'CHF' })
    expect(me.headers['x-request-id']).toBeDefined()
  })

  it('keeps one tenant’s rows invisible to another, through the API and through raw SQL', async () => {
    const acme = await t.createTenant({ name: 'Acme AG' })
    const globex = await t.createTenant({ name: 'Globex GmbH', country: 'DE', currency: 'EUR' })
    const customer = await t.createCustomer(acme.key)
    const invoice = await t.createInvoice(acme.key, customer.id)

    const theirs = await t.http
      .get('/v1/customers')
      .auth(globex.key, { type: 'bearer' })
      .expect(200)
    expect(theirs.body.items).toEqual([])
    await t.http
      .get(`/v1/customers/${customer.id}`)
      .auth(globex.key, { type: 'bearer' })
      .expect(404)
    await t.http.get(`/v1/invoices/${invoice.id}`).auth(globex.key, { type: 'bearer' }).expect(404)
    await t.http
      .post(`/v1/invoices/${invoice.id}/issue`)
      .auth(globex.key, { type: 'bearer' })
      .send({})
      .expect(404)

    // Outside any tenant scope the policies match nothing — even for the table owner.
    const [{ n }] = (await t.dataSource.query('select count(*)::int as n from invoices')) as [
      { n: number },
    ]
    expect(n).toBe(0)

    // And a scope cannot smuggle a row into another tenant.
    await expect(
      t.dataSource.transaction(async (manager) => {
        await manager.query(`select set_config('app.tenant_id', $1, true)`, [globex.tenantId])
        await manager.query(`insert into customers (tenant_id, name) values ($1, $2)`, [
          acme.tenantId,
          'Intruder',
        ])
      }),
    ).rejects.toThrow(/row-level security/)
  })

  it('nests roles: viewers read, accountants write, owners administer', async () => {
    const acme = await t.createTenant()
    const accountant = await t.issueKey(acme.tenantId, 'accountant')
    const viewer = await t.issueKey(acme.tenantId, 'viewer')

    await t.http
      .post('/v1/customers')
      .auth(viewer, { type: 'bearer' })
      .send({ name: 'X' })
      .expect(403)
    const created = await t.http
      .post('/v1/customers')
      .auth(accountant, { type: 'bearer' })
      .send({ name: 'X' })
      .expect(201)
    await t.http
      .get(`/v1/customers/${created.body.id}`)
      .auth(viewer, { type: 'bearer' })
      .expect(200)

    await t.http
      .patch('/v1/tenant')
      .auth(accountant, { type: 'bearer' })
      .send({ name: 'Y' })
      .expect(403)
    await t.http.get('/v1/tenant/api-keys').auth(accountant, { type: 'bearer' }).expect(403)
    const keys = await t.http
      .get('/v1/tenant/api-keys')
      .auth(acme.key, { type: 'bearer' })
      .expect(200)
    expect(keys.body).toHaveLength(3)
    expect(keys.body.map((k: { role: string }) => k.role).sort()).toEqual([
      'accountant',
      'owner',
      'viewer',
    ])
    expect(JSON.stringify(keys.body)).not.toContain(accountant)
  })

  it('stops honouring a revoked key', async () => {
    const acme = await t.createTenant()
    const viewer = await t.issueKey(acme.tenantId, 'viewer')
    const keys = await t.http
      .get('/v1/tenant/api-keys')
      .auth(acme.key, { type: 'bearer' })
      .expect(200)
    const viewerId = keys.body.find((k: { role: string }) => k.role === 'viewer').id
    await t.http.get('/v1/tenant').auth(viewer, { type: 'bearer' }).expect(200)
    await t.http
      .delete(`/v1/tenant/api-keys/${viewerId}`)
      .auth(acme.key, { type: 'bearer' })
      .expect(204)
    await t.http.get('/v1/tenant').auth(viewer, { type: 'bearer' }).expect(401)
    await t.http
      .delete(`/v1/tenant/api-keys/${viewerId}`)
      .auth(acme.key, { type: 'bearer' })
      .expect(404)
  })

  it('validates the dunning policy on update', async () => {
    const acme = await t.createTenant()
    const bad = await t.http
      .patch('/v1/tenant')
      .auth(acme.key, { type: 'bearer' })
      .send({
        dunningPolicy: {
          levels: [
            { afterDays: 10, feeMinor: 0, template: 'reminder' },
            { afterDays: 5, feeMinor: 0, template: 'final_notice' },
          ],
        },
      })
      .expect(422)
    expect(bad.body.error.code).toBe('invalid_dunning_policy')
    const good = await t.http
      .patch('/v1/tenant')
      .auth(acme.key, { type: 'bearer' })
      .send({
        paymentTermsDays: 30,
        dunningPolicy: {
          interestRateBps: 800,
          levels: [{ afterDays: 7, feeMinor: 500, template: 'reminder' }],
        },
      })
      .expect(200)
    expect(good.body.paymentTermsDays).toBe(30)
    expect(good.body.dunningPolicy).toMatchObject({
      interestRateBps: 800,
      graceDays: 0,
      responseDays: 10,
    })
  })
})
