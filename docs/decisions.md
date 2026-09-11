# Decisions

The choices that shaped the service, with what each one cost. Written so the next
person can tell a deliberate trade-off from an accident.

---

## 1. Row-level security, not a `where` clause

**Decision.** Tenant isolation is a Postgres policy on every tenant table, forced on the
table owner, keyed on a transaction-local setting.

**Why.** Application-side filtering is one forgotten `where` away from a breach, and the
forgetting happens in the fortieth query, not the first. With RLS the database refuses:
a query outside a scope sees nothing, an insert for another tenant is rejected, and the
e2e suite proves both with raw SQL. The policy is also the only place isolation is
defined, so it can be read in one screen.

**Cost.** Every query that touches tenant data must run inside a transaction with the
setting applied — hence a unit of work per request and per job, and a small amount of
ceremony in the workers. Superuser connections bypass it silently, so the role setup is
part of the deployment contract, not an afterthought.

---

## 2. Transaction-local `set_config`, and a unit of work per request

**Decision.** `set_config('app.tenant_id', …, true)` inside a transaction opened by an
interceptor; services read the manager from `AsyncLocalStorage`.

**Why.** The third argument makes the setting die with the transaction. A pooled
connection cannot carry one tenant into the next request, and there is no reset step to
forget. AsyncLocalStorage means no service signature carries a manager or a tenant id.

**Cost.** One transaction per request, including reads. For this shape of API — short,
small, indexed — it is not measurable. A long-running streaming response would need a
different scope.

---

## 3. TypeORM with hand-written migrations

**Decision.** TypeORM 1 for entities and queries, one hand-written SQL migration for the
schema.

**Why.** TypeORM is what the platforms this mirrors run on. The schema, with its check
constraints and policies, is the most important thing in the repository to be able to
read, and a generated diff buries it. `synchronize` is off everywhere.

**Cost.** Two sources of truth to keep aligned — entities and DDL — which the e2e suite
catches on every run. No query-builder support for `ON CONFLICT … RETURNING`, so the two
places that need it (numbering, idempotency) are raw SQL, which they would want to be
anyway.

---

## 4. Integer minor units, rounding once per line

**Decision.** No floats anywhere an amount lives. Quantities are thousandths; tax is
computed on the rounded net; totals are sums of rounded lines.

**Why.** The printed invoice is the contract. Customers check line totals with a
calculator and add them up; the API must agree with the calculator, not with a more
precise number it then rounds.

**Cost.** Quantities beyond three decimals are rejected, and per-line rounding can
differ from per-invoice rounding by a few minor units — which is the point.

---

## 5. Gapless numbers from a counter row, assigned on issue

**Decision.** `invoice_counters(tenant_id, year, next)`, advanced with a single
`INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the issuing transaction. Drafts have
no number.

**Why.** Tax authorities in the jurisdictions this mirrors expect sequential numbers
without gaps. A sequence object leaves gaps on rollback; a counter row locked in the
transaction does not, and a rolled-back issue simply releases the lock.

**Cost.** Issues within one tenant serialise on the row lock for the duration of the
issuing transaction — microseconds of lock for milliseconds of work. Across tenants there
is no contention at all.

---

## 6. Outbox rows plus a sweeper, not a relay

**Decision.** Mail, deliveries and imports are rows committed with their cause; jobs are
enqueued after commit with deterministic ids; a sweeper re-enqueues stale rows.

**Why.** The failure the outbox pattern exists for — the process dies between commit and
enqueue — is covered by the sweeper, and the code stays a few lines per call site. A
relay polling an events table is the same guarantee with a tighter window and another
moving part.

**Cost.** Up to a minute or two of delay in the rare crash case, and a sweeper that walks
every tenant every minute — cheap at this size, a candidate for the relay at a thousand.

---

## 7. One escalation level per scan

**Decision.** The dunning scan never skips a level, however overdue an invoice is.

**Why.** A collection file is evidence. A final notice that was not preceded by a
reminder is a weaker claim, and in some of the jurisdictions this mirrors an invalid one.
The policy's `afterDays` is a minimum, not a schedule.

**Cost.** An invoice discovered ninety days late takes three daily scans to reach its
final notice. `POST /v1/dunning/runs` with an `asOf` date exists partly so an operator
can walk it forward on purpose.

---

## 8. Notices freeze their amounts

**Decision.** A notice records the balance, fee and interest at the moment it is created
and never changes.

**Why.** The letter that was sent said a number; the record of the letter must say the
same number after a partial payment, or a later dispute has nothing to stand on. The
invoice's `dunning` summary sums fees across notices and takes interest from the latest,
which is what is currently claimable.

**Cost.** Interest is not accrued daily on the invoice; it is stated per notice. That
matches how reminder letters work and avoids a daily accrual job.

---

## 9. Payments never exceed the balance

**Decision.** A payment is applied to one invoice for at most its open balance; an
overpayment is a 422; a statement line that would overpay is reported, not applied.

**Why.** Modelling credit balances, refunds and customer accounts is a ledger, and a
ledger is a different service. Refusing keeps every invoice's `paid ≤ total` a check
constraint the database enforces.

**Cost.** Real statements contain overpayments and lump sums covering several invoices.
Both arrive as `unmatched` lines with a reason, for a person to allocate.

---

## 10. Idempotency by claiming the key first

**Decision.** For `@Idempotent()` handlers, the interceptor inserts the key with
`ON CONFLICT DO NOTHING` before the handler runs, inside the request's transaction, and
stores the response afterwards.

**Why.** Claiming first is what makes two simultaneous duplicates safe: the second blocks
on the unique index until the first commits, then finds a finished response to replay.
Storing after is what makes a failed request not poison its key — the rollback removes
the claim.

**Cost.** The stored response is the serialised body, so a replay is byte-identical to
the first answer even if the underlying row has since changed. That is the contract
clients expect from the header.

---

## 11. API keys hashed with SHA-256, not a slow hash

**Decision.** Keys are 192 random bits; the database stores their SHA-256.

**Why.** Slow hashes defend low-entropy secrets against offline guessing. There is
nothing to guess in 192 random bits, and a slow hash would put tens of milliseconds on
every request.

**Cost.** The plaintext is shown once and cannot be recovered — which is also the
feature.

---

## 12. One image, two roles

**Decision.** The same container runs as API or worker by environment variable; the API
role imports no processors.

**Why.** One build, one set of dependencies, one place a bug can be. Scaling the two
independently is a replica count, not a second pipeline.

**Cost.** The worker image carries Express and Swagger it never uses — a few megabytes.

---

## 13. Jest on ESM, with two dependencies replaced

**Decision.** NestJS 12 is ESM-only; the tests run on Jest with `ts-jest` in ESM mode.
Two CommonJS packages that `require()` `@nestjs/common` — `nestjs-pino` and
`@nestjs/throttler` — were replaced by sixty lines each: a pino `LoggerService` with a
request-log middleware, and a Redis-backed rate limiter keyed by API key.

**Why.** Jest's ESM runtime cannot load a CommonJS module that requires an ES module in a
cycle, and both packages do. Replacing them was less work than a second test runner, and
the replacements are better fits: request logs carry the tenant and key, and the limit
is per key rather than per IP.

**Cost.** Two small pieces of infrastructure to own instead of import.
