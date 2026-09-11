import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import { type AfterCommitHook, currentScope, enterScope } from './tenant-context.js'

/**
 * One transaction per unit of work, with the tenant pinned to it.
 *
 * `set_config(..., true)` is transaction-local: the setting exists only inside
 * this transaction, on this connection, and vanishes at commit or rollback. A
 * pooled connection can therefore never carry one tenant's id into another
 * tenant's request — the mistake that turns "multi-tenant" into a breach.
 *
 * Hooks registered with `afterCommit` run once the transaction has committed,
 * which is when it is safe to enqueue the job that reads what was written.
 */
@Injectable()
export class UnitOfWork {
  private readonly logger = new Logger(UnitOfWork.name)

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const existing = currentScope()
    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new Error(
          `Nested scope for tenant ${tenantId} inside a scope for ${existing.tenantId}`,
        )
      }
      return fn()
    }

    const hooks: AfterCommitHook[] = []
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
      return enterScope({ tenantId, manager, afterCommit: hooks }, fn)
    })

    for (const hook of hooks) {
      try {
        await hook()
      } catch (error) {
        // The write is committed; a failed hook is a job the sweeper will re-enqueue.
        this.logger.error({ err: error, tenantId }, 'after-commit hook failed')
      }
    }
    return result
  }
}
