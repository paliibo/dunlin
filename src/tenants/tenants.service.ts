import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import type { ApiKey } from '../auth/api-key.entity.js'
import { ApiKeysService, type IssuedKey } from '../auth/api-keys.service.js'
import { NotFoundError, UnprocessableError } from '../common/errors.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import {
  DEFAULT_DUNNING_POLICY,
  type DunningPolicy,
  dunningPolicySchema,
} from './dunning-policy.js'
import type {
  ApiKeyResponse,
  CreateTenantDto,
  IssuedApiKeyResponse,
  TenantResponse,
  UpdateTenantDto,
} from './dto/tenant.dto.js'
import { Tenant } from './tenant.entity.js'

export function parseDunningPolicy(input: unknown): DunningPolicy {
  const parsed = dunningPolicySchema.safeParse(input)
  if (!parsed.success) {
    throw new UnprocessableError(
      'invalid_dunning_policy',
      'The dunning policy is not valid',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return parsed.data
}

export function toTenantResponse(tenant: Tenant): TenantResponse {
  return {
    id: tenant.id,
    name: tenant.name,
    country: tenant.country,
    currency: tenant.currency,
    invoicePrefix: tenant.invoicePrefix,
    paymentTermsDays: tenant.paymentTermsDays,
    dunningPolicy: tenant.dunningPolicy,
    createdAt: tenant.createdAt.toISOString(),
  }
}

export function toApiKeyResponse(key: ApiKey): ApiKeyResponse {
  return {
    id: key.id,
    name: key.name,
    role: key.role,
    keyPrefix: key.keyPrefix,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  }
}

export function toIssuedKeyResponse(issued: IssuedKey): IssuedApiKeyResponse {
  return { ...toApiKeyResponse(issued.record), key: issued.plaintext }
}

@Injectable()
export class TenantsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly apiKeys: ApiKeysService,
    private readonly ctx: TenantContext,
  ) {}

  /** Platform: a tenant and the owner key that lets it do anything else. */
  async create(dto: CreateTenantDto): Promise<{ tenant: Tenant; key: IssuedKey }> {
    const dunningPolicy = parseDunningPolicy(dto.dunningPolicy ?? DEFAULT_DUNNING_POLICY)
    return this.dataSource.transaction(async (manager) => {
      const tenant = manager.create(Tenant, {
        name: dto.name,
        country: dto.country,
        currency: dto.currency,
        invoicePrefix: dto.invoicePrefix ?? 'INV',
        paymentTermsDays: dto.paymentTermsDays ?? 14,
        dunningPolicy,
      })
      await manager.save(tenant)
      const key = await this.apiKeys.issue(tenant.id, { name: 'Owner key', role: 'owner' }, manager)
      return { tenant, key }
    })
  }

  /** Platform: another key for an existing tenant. */
  async issueKey(
    tenantId: string,
    input: { name: string; role: ApiKey['role'] },
  ): Promise<IssuedKey> {
    const tenant = await this.dataSource.manager.findOneBy(Tenant, { id: tenantId })
    if (!tenant) throw new NotFoundError('Tenant', tenantId)
    return this.apiKeys.issue(tenant.id, input)
  }

  /** Tenant scope: the caller's own tenant. */
  async current(): Promise<Tenant> {
    const tenant = await this.ctx.manager.findOneBy(Tenant, { id: this.ctx.tenantId })
    if (!tenant) throw new NotFoundError('Tenant', this.ctx.tenantId)
    return tenant
  }

  async update(dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.current()
    if (dto.name !== undefined) tenant.name = dto.name
    if (dto.invoicePrefix !== undefined) tenant.invoicePrefix = dto.invoicePrefix
    if (dto.paymentTermsDays !== undefined) tenant.paymentTermsDays = dto.paymentTermsDays
    if (dto.dunningPolicy !== undefined)
      tenant.dunningPolicy = parseDunningPolicy(dto.dunningPolicy)
    return this.ctx.manager.save(tenant)
  }
}
