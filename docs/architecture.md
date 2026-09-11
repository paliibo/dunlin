# Architecture

## Shape of the thing

One NestJS module graph, started in one of two shapes. The **API** role serves HTTP and
never touches a queue processor; the **worker** role runs the processors and never
listens. Both are the same image; `DUNLIN_ROLE` decides, and `all` (local development,
the test suite) is both in one process.

```
                 ┌──────────────────────────┐        ┌──────────────────────────┐
   clients ────▶ │  API      (DUNLIN_ROLE=api)│        │ worker (DUNLIN_ROLE=worker)│
                 │  guards → tx → handler    │        │ processors, cron, sweeper  │
                 └─────┬──────────────┬──────┘        └─────┬──────────────┬─────┘
                       │              │ jobs after commit   │              │
                       ▼              ▼                     ▼              ▼
              ┌─────────────┐   ┌───────────┐        ┌─────────────┐   ┌────────────┐
              │ Postgres 16 │   │ Redis 7   │        │ SMTP        │   │ tenant     │
              │ RLS on every│   │ BullMQ    │        │ (Mailpit)   │   │ webhooks   │
              │ tenant table│   │ 6 queues  │        └─────────────┘   └────────────┘
              └─────────────┘   └───────────┘
```

## A request, end to end

1. **ApiKeyGuard** — `Authorization: Bearer dnl_…` is hashed (SHA-256; the key is 192
   random bits, so no slow hash is needed) and looked up in `api_keys`, a platform table
   with no row-level security because it is what tells us the tenant. The result is
   `request.principal`. Handlers marked `@PlatformOnly()` take `X-Platform-Token`
   instead; `@Public()` handlers (the health check) take nothing.
2. **RolesGuard** — `@RequireRole('accountant')` names a floor: owner ⊇ accountant ⊇
   viewer.
3. **RateLimitGuard** — `INCR` on `ratelimit:<key id>:<minute>` in Redis, keyed by the
   API key rather than the IP that every request from one integration shares.
4. **TenantTransactionInterceptor** — `UnitOfWork.run(tenantId, …)`: `BEGIN`,
   `set_config('app.tenant_id', $1, true)`, and the handler runs inside an
   `AsyncLocalStorage` scope that carries the transaction's `EntityManager`.
5. **IdempotencyInterceptor** (inside the transaction, for `@Idempotent()` handlers with
   an `Idempotency-Key`) — `INSERT … ON CONFLICT DO NOTHING` claims the key before the
   handler runs. A concurrent duplicate blocks on the unique index until the first
   commits, then reads back the stored response and replays it with
   `Idempotent-Replayed: true`. The same key with a different body is a 422.
6. **Handler → service** — services call `TenantContext.repo(Entity)` and never see a
   tenant id, a transaction or a connection.
7. **COMMIT**, then the **after-commit hooks** enqueue the jobs for the outbox rows the
   transaction wrote. A rolled-back transaction runs no hooks.

## Tenancy

Every tenant table is created with

```sql
alter table … enable row level security;
alter table … force row level security;
create policy tenant_isolation on … using (tenant_id = current_tenant_id())
                                 with check (tenant_id = current_tenant_id());
```

where `current_tenant_id()` is `nullif(current_setting('app.tenant_id', true), '')::uuid`
— the `nullif` matters, because after a transaction ends the setting reads as `''`, and
`''::uuid` is an error rather than a NULL.

`force` is what makes the policy apply to the table owner. The application connects as
the owner (one role, no privilege choreography), so without `force` it would see
everything. It must not connect as a superuser: superusers bypass RLS unconditionally,
which is why `db/init/01-roles.sql` creates a plain role and CI runs the same script.

`set_config(…, true)` is transaction-local. It cannot leak across pooled connections, and
there is no "forgot to reset it" failure mode. `tenant_id` columns also default to
`current_tenant_id()`, so an insert that forgets the column still lands in the right
tenant, and the `with check` half of the policy rejects an insert that names another.

Two tables are platform-level and unfenced: `tenants` and `api_keys`. They are read by
id, never listed by a tenant, and the tenant-facing endpoints only ever touch the
caller's own row.

## Money

Amounts are `bigint` minor units in the database and integers in the application; the
column transformer converts the driver's string. Quantities are `numeric(12,3)` and are
turned into thousandths before multiplication, so every intermediate value is an integer
inside the exact range of a double. Rounding is half away from zero, applied once per
line to the net and once to the tax on that rounded net. Invoice totals are sums of
lines, never a re-rounded grand total: the document and a customer with a calculator
agree.

Interest is simple: `balance × rate_bps / 10 000 × days / 365`, rounded once at the end.

## The live paths

**Issuing an invoice** locks the draft (`FOR UPDATE`), takes the next number from
`invoice_counters` with one `INSERT … ON CONFLICT DO UPDATE … RETURNING`, sets the due
date from the customer's or the tenant's payment terms, and — still inside the
transaction — writes an outbox row for the mail and delivery rows for every subscribed
webhook. After commit: a render job, a send job, delivery jobs.

**A payment** locks the invoice, refuses more than the open balance, appends a payment
row, updates `paid_minor` and the status, and emits `payment.recorded` and, when the
balance reaches zero, `invoice.paid`. Bank reconciliation calls exactly this, line by
line, with the candidate list updated after each match so a statement with two payments
for one invoice settles it rather than overpaying it.

**Dunning** runs as `scan-all` on a cron (a BullMQ job scheduler), which enqueues one
`scan-tenant` job per tenant. Each scan considers open, unpaused invoices past due,
locks each, plans at most one escalation with the pure `planEscalation`, writes the
notice with frozen amounts, bumps the invoice's level, and queues letter, mail and event.
`POST /v1/dunning/runs` runs the same code for the caller's tenant on demand, with an
`asOf` date, which is how the test suite and a curious reviewer drive it.

## Reliability

- **Outbox.** Mail, webhook deliveries and bank imports are rows first, committed with
  the change that caused them; the job is enqueued after commit with a deterministic id
  derived from the row. If the process dies in between, the row exists and the job does
  not; the **sweeper** (a repeatable job every minute) re-enqueues rows still `queued` or
  `pending` after two minutes. Deterministic ids mean an existing job is not added twice.
- **Retries.** Mail: 5 attempts, exponential backoff. Webhooks: 6 attempts. Renders and
  imports: 3. The last failed attempt marks the row `failed` with the reason; nothing
  retries forever, nothing fails silently.
- **Idempotent processors.** A render checks for an existing document; a send skips a
  row already `sent`; a delivery skips one already `delivered`; a reconciliation skips
  lines no longer `pending`. Re-running any job is safe.
- **Health.** `/health` pings Postgres and Redis and returns 503 when either is down, so
  a broken instance leaves the load balancer instead of answering with errors.

## What is not here

- **A transactional outbox relay.** Jobs are enqueued after commit and repaired by a
  sweeper, rather than by a relay reading a `domain_events` table. The sweeper is the
  simpler half of the same guarantee and is enough at this size; the relay is what to
  add when the one-minute repair window matters.
- **Overpayments and unapplied cash.** A payment applies to one invoice for at most its
  balance. Real books carry credit balances and customer accounts; here an overpayment is
  a 422 and an unmatched statement line is a reported line, both of which are decisions
  for a person.
- **Multi-currency.** Every invoice is in the tenant's currency; a statement line in
  another currency is `currency_mismatch`. Conversion is a rate provider and a policy,
  not a data model change.
- **Signed public document links.** PDFs are served behind the API key. A link in a
  customer's mail would need a signed, expiring URL.
- **Elasticsearch, MinIO, RabbitMQ.** The stacks this mirrors run them; the reasons
  (search over documents, object storage, cross-service events) do not arise inside one
  service with one database.
