import { Injectable } from '@nestjs/common'

import { TenantContext } from '../tenancy/tenant-context.js'

/**
 * Gapless per-tenant, per-year sequences. One statement, one row lock:
 * concurrent issues queue behind each other for the few microseconds the
 * update takes, and the numbers come out consecutive. The lock is released
 * with the issuing transaction, so a rolled-back issue never burns a number.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly ctx: TenantContext) {}

  async next(year: number, prefix: string): Promise<string> {
    const rows = (await this.ctx.manager.query(
      `insert into invoice_counters (tenant_id, year, next) values ($1, $2, 2)
       on conflict (tenant_id, year) do update set next = invoice_counters.next + 1
       returning next - 1 as seq`,
      [this.ctx.tenantId, year],
    )) as Array<{ seq: number | string }>
    const seq = Number(rows[0]?.seq)
    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`
  }
}
