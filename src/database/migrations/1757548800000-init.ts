import type { MigrationInterface, QueryRunner } from 'typeorm'

import { TENANT_TABLES } from '../entities.js'

/**
 * The whole schema, hand-written: what the database enforces is the part of
 * this service most worth reading, and a generated diff would bury it.
 *
 * Tenant isolation lives here, not in the application. Every tenant table has
 * a row-level security policy that compares `tenant_id` with the transaction
 * setting `app.tenant_id`; a query outside a tenant scope sees no rows at all,
 * and an insert for another tenant is rejected. FORCE makes the policy apply
 * to the table owner too, which is the role the application connects as.
 */
export class Init1757548800000 implements MigrationInterface {
  name = 'Init1757548800000'

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      create table tenants (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        country char(2) not null,
        currency char(3) not null,
        invoice_prefix text not null default 'INV',
        payment_terms_days int not null default 14 check (payment_terms_days between 0 and 365),
        dunning_policy jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`)

    await q.query(`
      create table api_keys (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references tenants (id) on delete cascade,
        name text not null,
        role text not null check (role in ('owner', 'accountant', 'viewer')),
        key_prefix text not null,
        key_hash text not null unique,
        created_at timestamptz not null default now(),
        last_used_at timestamptz,
        revoked_at timestamptz
      )`)
    await q.query(`create index api_keys_tenant_idx on api_keys (tenant_id)`)

    // The current tenant, as set by the unit of work for the transaction. NULL
    // outside any scope — never '' — so the uuid cast below cannot blow up.
    await q.query(`
      create function current_tenant_id() returns uuid
        language sql stable
        as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$`)

    await q.query(`
      create table customers (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        name text not null,
        email text,
        address jsonb,
        vat_id text,
        payment_terms_days int check (payment_terms_days between 0 and 365),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`)
    await q.query(`create index customers_tenant_name_idx on customers (tenant_id, name)`)

    await q.query(`
      create table invoices (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        customer_id uuid not null references customers (id) on delete restrict,
        number text,
        status text not null check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void')),
        currency char(3) not null,
        issued_on date,
        due_on date,
        subtotal_minor bigint not null,
        tax_minor bigint not null,
        total_minor bigint not null,
        paid_minor bigint not null default 0 check (paid_minor >= 0 and paid_minor <= total_minor),
        notes text,
        dunning_level int not null default 0,
        dunning_paused boolean not null default false,
        last_dunned_on date,
        voided_at timestamptz,
        void_reason text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        -- Drafts have no number, issued invoices always do, and a voided one keeps whatever it had.
        check (
          (status = 'draft' and number is null)
          or (status in ('issued', 'partially_paid', 'paid') and number is not null)
          or status = 'void'
        )
      )`)
    await q.query(
      `create unique index invoices_tenant_number_idx on invoices (tenant_id, number) where number is not null`,
    )
    await q.query(`create index invoices_tenant_status_idx on invoices (tenant_id, status)`)
    await q.query(`create index invoices_tenant_customer_idx on invoices (tenant_id, customer_id)`)
    await q.query(`create index invoices_tenant_due_idx on invoices (tenant_id, due_on)`)
    await q.query(
      `create index invoices_tenant_created_idx on invoices (tenant_id, created_at desc, id desc)`,
    )

    await q.query(`
      create table invoice_lines (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        invoice_id uuid not null references invoices (id) on delete cascade,
        position int not null,
        description text not null,
        quantity numeric(12, 3) not null check (quantity > 0),
        unit_price_minor bigint not null,
        tax_rate_bps int not null check (tax_rate_bps between 0 and 10000),
        net_minor bigint not null,
        tax_minor bigint not null,
        total_minor bigint not null,
        unique (invoice_id, position)
      )`)

    await q.query(`
      create table invoice_counters (
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        year int not null,
        next int not null default 1,
        primary key (tenant_id, year)
      )`)

    await q.query(`
      create table payments (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        invoice_id uuid not null references invoices (id) on delete restrict,
        amount_minor bigint not null check (amount_minor > 0),
        currency char(3) not null,
        received_on date not null,
        method text not null check (method in ('bank_transfer', 'card', 'cash', 'other')),
        reference text,
        source text not null check (source in ('manual', 'bank_import')),
        bank_import_line_id uuid,
        created_at timestamptz not null default now()
      )`)
    await q.query(`create index payments_tenant_invoice_idx on payments (tenant_id, invoice_id)`)

    await q.query(`
      create table bank_imports (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        status text not null check (status in ('queued', 'processing', 'completed', 'failed')),
        source_name text,
        line_count int not null,
        matched_count int not null default 0,
        unmatched_count int not null default 0,
        error text,
        created_at timestamptz not null default now(),
        completed_at timestamptz
      )`)
    await q.query(
      `create index bank_imports_tenant_created_idx on bank_imports (tenant_id, created_at desc, id desc)`,
    )

    await q.query(`
      create table bank_import_lines (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        import_id uuid not null references bank_imports (id) on delete cascade,
        position int not null,
        booked_on date not null,
        amount_minor bigint not null,
        currency char(3) not null,
        counterparty text,
        reference text,
        status text not null default 'pending' check (status in ('pending', 'matched', 'unmatched')),
        invoice_id uuid references invoices (id) on delete set null,
        payment_id uuid references payments (id) on delete set null,
        reason text,
        unique (import_id, position)
      )`)

    await q.query(`
      create table dunning_notices (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        invoice_id uuid not null references invoices (id) on delete cascade,
        level int not null check (level >= 1),
        template text not null,
        issued_on date not null,
        respond_by date not null,
        days_overdue int not null,
        balance_minor bigint not null,
        fee_minor bigint not null,
        interest_minor bigint not null,
        created_at timestamptz not null default now(),
        unique (tenant_id, invoice_id, level)
      )`)

    await q.query(`
      create table documents (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        kind text not null check (kind in ('invoice', 'dunning_notice')),
        subject_id uuid not null,
        file_name text not null,
        content_type text not null,
        body bytea not null,
        size_bytes int not null,
        created_at timestamptz not null default now(),
        unique (tenant_id, kind, subject_id)
      )`)

    await q.query(`
      create table mail_outbox (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        to_email text not null,
        subject text not null,
        text_body text not null,
        template text not null,
        subject_id uuid,
        status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
        attempts int not null default 0,
        last_error text,
        message_id text,
        sent_at timestamptz,
        created_at timestamptz not null default now()
      )`)
    await q.query(`create index mail_outbox_tenant_status_idx on mail_outbox (tenant_id, status)`)

    await q.query(`
      create table webhook_endpoints (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        url text not null,
        secret text not null,
        events text[] not null,
        active boolean not null default true,
        created_at timestamptz not null default now()
      )`)
    await q.query(`create index webhook_endpoints_tenant_idx on webhook_endpoints (tenant_id)`)

    await q.query(`
      create table webhook_deliveries (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        endpoint_id uuid not null references webhook_endpoints (id) on delete cascade,
        event_id uuid not null,
        event_type text not null,
        payload jsonb not null,
        status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
        attempts int not null default 0,
        last_status_code int,
        last_error text,
        delivered_at timestamptz,
        created_at timestamptz not null default now()
      )`)
    await q.query(
      `create index webhook_deliveries_tenant_status_idx on webhook_deliveries (tenant_id, status)`,
    )
    await q.query(
      `create index webhook_deliveries_endpoint_idx on webhook_deliveries (tenant_id, endpoint_id, created_at desc)`,
    )

    await q.query(`
      create table idempotency_keys (
        tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
        key text not null,
        fingerprint text not null,
        status_code int,
        response jsonb,
        created_at timestamptz not null default now(),
        primary key (tenant_id, key)
      )`)

    for (const table of TENANT_TABLES) {
      await q.query(`alter table ${table} enable row level security`)
      await q.query(`alter table ${table} force row level security`)
      await q.query(`
        create policy tenant_isolation on ${table}
          using (tenant_id = current_tenant_id())
          with check (tenant_id = current_tenant_id())`)
    }
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of [...TENANT_TABLES].reverse()) {
      await q.query(`drop table if exists ${table} cascade`)
    }
    await q.query(`drop function if exists current_tenant_id()`)
    await q.query(`drop table if exists api_keys`)
    await q.query(`drop table if exists tenants`)
  }
}
