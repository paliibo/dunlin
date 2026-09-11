import { AsyncLocalStorage } from 'node:async_hooks'

import { Injectable } from '@nestjs/common'
import type { EntityManager, EntityTarget, ObjectLiteral, Repository } from 'typeorm'

export type AfterCommitHook = () => unknown

/** Everything a piece of code needs to know about the tenant it is running for. */
export interface TenantScope {
  tenantId: string
  /** The transaction's manager. Every query in the scope goes through it, so RLS sees the tenant setting. */
  manager: EntityManager
  afterCommit: AfterCommitHook[]
}

const storage = new AsyncLocalStorage<TenantScope>()

export function enterScope<T>(scope: TenantScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn)
}

export function currentScope(): TenantScope | undefined {
  return storage.getStore()
}

/**
 * The tenant scope, from wherever code happens to be running: a request
 * handler, a queue processor, a test. Backed by AsyncLocalStorage, so nothing
 * has to thread a manager through every call.
 */
@Injectable()
export class TenantContext {
  get scope(): TenantScope {
    const scope = storage.getStore()
    if (!scope) throw new Error('No tenant scope: this code must run inside UnitOfWork.run()')
    return scope
  }

  get tenantId(): string {
    return this.scope.tenantId
  }

  get manager(): EntityManager {
    return this.scope.manager
  }

  repo<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
    return this.scope.manager.getRepository(entity)
  }

  /** Runs after the surrounding transaction commits; skipped if it rolls back. */
  afterCommit(hook: AfterCommitHook): void {
    this.scope.afterCommit.push(hook)
  }
}
