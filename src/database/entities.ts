import { ApiKey } from '../auth/api-key.entity.js'
import { BankImport, BankImportLine } from '../bank-imports/bank-import.entity.js'
import { Customer } from '../customers/customer.entity.js'
import { StoredDocument } from '../documents/document.entity.js'
import { DunningNotice } from '../dunning/dunning-notice.entity.js'
import { IdempotencyKey } from '../idempotency/idempotency-key.entity.js'
import { Invoice, InvoiceCounter, InvoiceLine } from '../invoices/invoice.entity.js'
import { OutboxMessage } from '../mail/outbox.entity.js'
import { Payment } from '../payments/payment.entity.js'
import { Tenant } from '../tenants/tenant.entity.js'
import { WebhookDelivery, WebhookEndpoint } from '../webhooks/webhook.entity.js'

/** Listed explicitly: ESM has no glob-based entity discovery, and explicit is easier to review. */
export const ENTITIES = [
  Tenant,
  ApiKey,
  Customer,
  Invoice,
  InvoiceLine,
  InvoiceCounter,
  Payment,
  BankImport,
  BankImportLine,
  DunningNotice,
  StoredDocument,
  OutboxMessage,
  WebhookEndpoint,
  WebhookDelivery,
  IdempotencyKey,
]

/** Tables that carry a tenant_id and are fenced by row-level security. */
export const TENANT_TABLES = [
  'customers',
  'invoices',
  'invoice_lines',
  'invoice_counters',
  'payments',
  'bank_imports',
  'bank_import_lines',
  'dunning_notices',
  'documents',
  'mail_outbox',
  'webhook_endpoints',
  'webhook_deliveries',
  'idempotency_keys',
] as const
