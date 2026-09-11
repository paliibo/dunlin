import { createHash, randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, type EntityManager, IsNull } from 'typeorm'

import { ApiKey, type Role } from './api-key.entity.js'
import type { Principal } from './principal.js'

const KEY_PREFIX = 'dnl_'

export interface IssuedKey {
  record: ApiKey
  /** The full key. Returned once and never stored. */
  plaintext: string
}

/**
 * Keys are platform-level rows, read before any tenant scope exists, so this
 * service uses the data source's own manager rather than the tenant context.
 */
@Injectable()
export class ApiKeysService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  static hash(plaintext: string): string {
    return createHash('sha256').update(plaintext, 'utf8').digest('hex')
  }

  async issue(
    tenantId: string,
    input: { name: string; role: Role },
    manager: EntityManager = this.dataSource.manager,
  ): Promise<IssuedKey> {
    const plaintext = KEY_PREFIX + randomBytes(24).toString('base64url')
    const record = manager.create(ApiKey, {
      tenantId,
      name: input.name,
      role: input.role,
      keyPrefix: plaintext.slice(0, KEY_PREFIX.length + 8),
      keyHash: ApiKeysService.hash(plaintext),
    })
    await manager.save(record)
    return { record, plaintext }
  }

  async authenticate(plaintext: string): Promise<Principal | null> {
    if (!plaintext.startsWith(KEY_PREFIX)) return null
    const key = await this.dataSource.manager.findOne(ApiKey, {
      where: { keyHash: ApiKeysService.hash(plaintext), revokedAt: IsNull() },
    })
    if (!key) return null

    // Best effort, off the request path: a stale last_used_at is not worth a failed request.
    void this.dataSource.manager
      .update(ApiKey, { id: key.id }, { lastUsedAt: new Date() })
      .catch(() => undefined)

    return { kind: 'tenant', tenantId: key.tenantId, role: key.role, keyId: key.id }
  }

  async list(tenantId: string): Promise<ApiKey[]> {
    return this.dataSource.manager.find(ApiKey, {
      where: { tenantId },
      order: { createdAt: 'ASC' },
    })
  }

  async revoke(tenantId: string, keyId: string): Promise<boolean> {
    const result = await this.dataSource.manager.update(
      ApiKey,
      { id: keyId, tenantId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    )
    return (result.affected ?? 0) > 0
  }
}
