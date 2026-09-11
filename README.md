<div align="center">

# Dunlin

**Multi-tenant invoicing, dunning and payment reconciliation — as an API.**
The slice of a collections and finance platform where the money is: invoices with
gapless numbers, reminders that escalate with fees and interest, bank statements matched
to what they pay, and tenants that cannot see each other even if the code tries.

[![CI](https://github.com/paliibo/dunlin/actions/workflows/ci.yml/badge.svg)](https://github.com/paliibo/dunlin/actions/workflows/ci.yml)
![NestJS 12](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL RLS](https://img.shields.io/badge/PostgreSQL-row--level%20security-4169E1?logo=postgresql&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-Redis-DC382D?logo=redis&logoColor=white)
![Tests](https://img.shields.io/badge/tests-54%20unit%20%2B%2029%20e2e-brightgreen)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## What this is

A NestJS service that a company (a _tenant_) integrates with an API key:

- **Invoices** with line items, per-line tax, integer minor units, and a number that is
  assigned only on issue — per tenant, per year, gapless even when two requests issue at
  once.
- **Dunning** — a per-tenant escalation policy (reminder → second reminder → final
  notice) applied by a daily scan: each step charges its flat fee and pro-rata
  late-payment interest, produces a letter, sends a mail and fires a webhook.
- **Reconciliation** — bank statement lines submitted in bulk and matched to open
  invoices in the background, by invoice number in the remittance text or by exact
  balance from a known counterparty; everything else is reported, never guessed.
- **Isolation** enforced by Postgres row-level security, not by remembering to add a
  `where`. A query outside a tenant scope returns nothing. An insert for another tenant
  is rejected. The test suite tries both.
- Around it: API keys with nested roles, an `Idempotency-Key` header on every mutating
  call, signed webhooks with retries, a transactional outbox for mail and events, a
  per-key rate limit, health checks, a single OpenAPI document, and one Docker image
  that runs as the API or as the worker.

Everything runs from `docker compose up`. There is no external service to sign up for.

```bash
git clone https://github.com/paliibo/dunlin.git && cd dunlin
docker compose --profile app up --build
```

Then open <http://localhost:3000/docs>. Mail the system sends lands in Mailpit at
<http://localhost:8025>.

---

## A tour, in six requests

```bash
# 1. The platform creates a tenant and gets its owner key (shown once).
curl -s localhost:3000/v1/tenants -H 'X-Platform-Token: compose-only-platform-token-change-me' \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Treuhand AG","country":"CH","currency":"CHF","paymentTermsDays":14}'
# → { "tenant": {...}, "apiKey": { "key": "dnl_…", "role": "owner" } }
export KEY=dnl_…

# 2. A customer.
curl -s localhost:3000/v1/customers -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"name":"Muster GmbH","email":"ap@muster.example","address":{"line1":"Bahnhofstrasse 1","postalCode":"8001","city":"Zürich","country":"CH"}}'

# 3. A draft invoice: 2 × 19.99 at 20 % tax, 1.5 × 10.00 at 7 %.
curl -s localhost:3000/v1/invoices -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -H 'Idempotency-Key: first-invoice' \
  -d '{"customerId":"…","lines":[
        {"description":"Consulting","quantity":2,"unitPriceMinor":1999,"taxRateBps":2000},
        {"description":"Travel","quantity":1.5,"unitPriceMinor":1000,"taxRateBps":700}]}'
# → subtotalMinor 5498, taxMinor 905, totalMinor 6403, status "draft"

# 4. Issue it: number INV-2026-0001, due in 14 days, PDF rendered, mail sent, webhook fired.
curl -s -X POST localhost:3000/v1/invoices/…/issue -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{}'
curl -s localhost:3000/v1/invoices/…/pdf -H "authorization: Bearer $KEY" -o INV-2026-0001.pdf

# 5. A bank statement, reconciled in the background.
curl -s localhost:3000/v1/bank-imports -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"lines":[{"bookedOn":"2026-09-21","amountMinor":6403,"currency":"CHF","counterparty":"MUSTER GMBH","reference":"Zahlung INV-2026-0001"}]}'
# → 202; GET /v1/bank-imports/{id} shows each line matched or why not.

# 6. Or, if nobody pays: run the dunning scan as of a date and watch it escalate.
curl -s localhost:3000/v1/dunning/runs -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"asOf":"2026-10-15"}'
# → { "escalated": [ { "level": 2, "feeMinor": 1500, "interestMinor": 411, … } ] }
```

The full contract is in [`openapi.json`](openapi.json), served live at `/docs`.

---

## How it is put together

```
 HTTP request                          Postgres (RLS)                    Redis / BullMQ
 ────────────────────────────────      ─────────────────────────────     ─────────────────────
 ApiKeyGuard      sha256(key) ─────▶   api_keys (platform table)
 RolesGuard       owner ⊇ accountant ⊇ viewer
 RateLimitGuard   INCR per key/minute ────────────────────────────────▶  ratelimit:<key>:<min>
 TenantTransactionInterceptor
   BEGIN; set_config('app.tenant_id', …, true)   ◀── every policy reads this
   IdempotencyInterceptor  INSERT … ON CONFLICT DO NOTHING ──▶ idempotency_keys
   handler → service       rows ──────────────────────────────▶ invoices, payments, …
                           outbox rows ───────────────────────▶ mail_outbox, webhook_deliveries
   COMMIT
   afterCommit hooks ─────────────────────────────────────────────────▶ queue.add(jobId = row id)

 Worker (same image, DUNLIN_ROLE=worker)
   documents  render invoice / notice PDF ──▶ documents (bytea)
   mail       outbox row → SMTP / JSON transport → status, attempts, message id
   webhooks   delivery row → POST with X-Dunlin-Signature → retries, exponential backoff
   bank-imports  lines → match → payments → invoice status → bank_import.completed
   dunning    scan-all (cron) → scan-tenant per tenant → notices, letters, mail, events
   maintenance  every minute: re-enqueue committed rows whose job never made it
```

**Tenancy.** Every tenant table has `enable row level security`, `force row level security`
and one policy: `tenant_id = current_tenant_id()`. The application connects as the table
owner, which is why `force` is there, and never as a superuser, which is why the compose
file creates a role. `UnitOfWork.run(tenantId, fn)` opens a transaction, sets the
transaction-local `app.tenant_id`, and runs `fn` inside an `AsyncLocalStorage` scope; a
pooled connection can therefore never carry one tenant's id into another's request.
Services ask `TenantContext` for the current manager and think about nothing else.

**Money.** Integer minor units, never floats. Quantities have at most three decimals and
are multiplied as thousandths. Each line is rounded once (half away from zero), tax is
computed on the rounded net, totals are sums of rounded lines — what the printed document
shows is what the numbers are.

**Numbering.** `invoice_counters(tenant_id, year, next)`, advanced by one
`INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the issuing transaction. Concurrent
issues queue on the row lock; a rolled-back issue never burns a number. The e2e suite
issues six drafts at once and asserts `0001`–`0006`.

**Outbox.** A mail or a webhook delivery is a row before it is a job. The row commits with
the change that caused it; the job is enqueued after commit with the row's id as its job
id; a sweeper re-enqueues stale rows every minute. Nothing is sent for a change that rolled
back, and nothing committed is lost to a process dying between commit and enqueue.

**Dunning.** A tenant's policy is JSON on the tenant: levels with `afterDays`, `feeMinor`
and a letter template, plus grace days, an annual interest rate in basis points and a
response window. One level per scan, in order — an invoice ignored for ninety days still
gets its first reminder before its final notice, because that is what a court asks to see.
Interest is simple, pro rata by day, on the balance at the time of the notice, and the
notice freezes its amounts.

More in [`docs/architecture.md`](docs/architecture.md); the trade-offs, with what each
one cost, in [`docs/decisions.md`](docs/decisions.md).

---

## Stack

|           |                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Runtime   | Node 24, TypeScript strict, ESM                                                                      |
| Framework | NestJS 12 — guards, interceptors, `@nestjs/swagger`, `@nestjs/terminus`                              |
| Database  | PostgreSQL 16, TypeORM 1 with hand-written SQL migrations, row-level security                        |
| Jobs      | BullMQ 6 on Redis 7 — five queues, retries with backoff, cron via job schedulers                     |
| Documents | pdfkit                                                                                               |
| Mail      | nodemailer — SMTP in compose (Mailpit), JSON transport in tests                                      |
| Tests     | Jest 30 (ESM) — unit tests on the pure modules, Supertest end-to-end against real Postgres and Redis |
| Ops       | multi-stage Dockerfile, non-root, one image for API and worker; GitHub Actions                       |

---

## Running it locally

```bash
docker compose up -d          # postgres :5433, redis :6380, mailpit :8025
cp .env.example .env
pnpm install
pnpm start:dev                # migrates on boot; http://localhost:3000/docs
```

| Command                     | What it does                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm start:dev`            | API and worker in one process, reloading on change                                    |
| `pnpm build` · `pnpm start` | Compile, then run `dist/main.js`                                                      |
| `pnpm start:worker`         | The compiled worker only                                                              |
| `pnpm db:migrate`           | Apply pending migrations explicitly (`DB_MIGRATE_ON_BOOT=0` to stop the app doing it) |
| `pnpm test`                 | Unit tests                                                                            |
| `pnpm test:e2e`             | End-to-end, against the compose services                                              |
| `pnpm openapi:export`       | Regenerate `openapi.json`; CI fails if the committed one drifts                       |
| `pnpm verify`               | Types, lint, format, unit and e2e — what CI runs                                      |

---

## Testing

**54 unit tests** cover the parts where a wrong answer is silent: rounding and tax per
line, pro-rata interest, the escalation plan for every policy edge, the statement matcher's
rules and refusals, cursor encoding, signature verification, role nesting. They are pure
functions, so they run in under a second.

**29 end-to-end tests** run the whole application against real Postgres and Redis with
the workers inline, and cover what a unit test cannot: that tenant B gets a 404 for tenant
A's invoice, that a raw `select count(*)` outside a scope returns zero and an insert for
another tenant is refused by the policy, that six concurrent issues produce six
consecutive numbers, that the PDF really is a PDF, that the mail really went out, that a
webhook arrives with a signature that verifies, retries through two failures and gives up
after six, that an `Idempotency-Key` replays the first response and rejects a different
body, and that a bank statement settles the invoices it names.

```bash
docker compose up -d
pnpm test && pnpm test:e2e
```

---

## Deployment

`docker compose --profile app up --build` runs the whole system: the API applies
migrations on boot and answers `/health` once Postgres and Redis do; the worker starts
after the API is healthy. The image is the same for both — `DUNLIN_ROLE` decides.

Anywhere else: build the image, point `DATABASE_URL` at a Postgres role that is **not a
superuser** (superusers bypass row-level security), `REDIS_URL` at Redis, set
`PLATFORM_TOKEN` and `SMTP_URL`, and run one or more instances of each role. Migrations
serialise on Postgres' own lock, so several API instances starting together is fine.

---

## Project layout

```
src/
├── config/          zod-validated environment, one injectable object
├── common/          errors and the one error shape, money, dates, pagination, logger, clock
├── database/        TypeORM data source, the hand-written migration with the RLS policies
├── tenancy/         TenantContext (AsyncLocalStorage) · UnitOfWork · the transaction interceptor
├── auth/            API keys, guards: authentication, roles, rate limit
├── tenants/         tenant settings and the dunning policy schema
├── customers/
├── invoices/        drafts, totals, issuing, numbering, listing, PDF
├── payments/        applying money under a row lock
├── bank-imports/    the pure matcher and the background reconciliation
├── dunning/         the pure escalation plan and the scan
├── documents/       PDF rendering and storage
├── mail/            outbox, transport, templates
├── webhooks/        endpoints, deliveries, HMAC signatures
├── events/          domain events → deliveries → jobs after commit
├── idempotency/     Idempotency-Key interceptor
├── health/          terminus with Postgres and Redis probes
├── queues/          BullMQ connection and queue names
├── workers/         processors, the dunning scheduler, the sweeper
└── openapi/         the document builder and the export script
test/
├── helpers/         boots the application against the real services
└── e2e/             tenancy · invoicing · payments and reconciliation · dunning · webhooks
```

---

## Licence

MIT — see [LICENSE](LICENSE).
