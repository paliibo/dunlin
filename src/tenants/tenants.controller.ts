import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'

import { ApiKeysService } from '../auth/api-keys.service.js'
import { PlatformOnly, RequireRole } from '../auth/decorators.js'
import { NotFoundError } from '../common/errors.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import {
  ApiKeyResponse,
  CreatedTenantResponse,
  CreateTenantDto,
  IssueApiKeyDto,
  IssuedApiKeyResponse,
  TenantResponse,
  UpdateTenantDto,
} from './dto/tenant.dto.js'
import {
  TenantsService,
  toApiKeyResponse,
  toIssuedKeyResponse,
  toTenantResponse,
} from './tenants.service.js'

@ApiTags('Platform')
@ApiSecurity('platform')
@Controller('v1/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @PlatformOnly()
  @ApiOperation({ summary: 'Create a tenant and its owner API key' })
  @ApiCreatedResponse({ type: CreatedTenantResponse })
  async create(@Body() dto: CreateTenantDto): Promise<CreatedTenantResponse> {
    const { tenant, key } = await this.tenants.create(dto)
    return { tenant: toTenantResponse(tenant), apiKey: toIssuedKeyResponse(key) }
  }

  @Post(':id/api-keys')
  @PlatformOnly()
  @ApiOperation({ summary: 'Issue an additional API key for a tenant' })
  @ApiCreatedResponse({ type: IssuedApiKeyResponse })
  async issueKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueApiKeyDto,
  ): Promise<IssuedApiKeyResponse> {
    return toIssuedKeyResponse(await this.tenants.issueKey(id, dto))
  }
}

@ApiTags('Tenant')
@ApiBearerAuth('api-key')
@Controller('v1/tenant')
export class TenantController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly apiKeys: ApiKeysService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The tenant the API key belongs to' })
  @ApiOkResponse({ type: TenantResponse })
  async me(): Promise<TenantResponse> {
    return toTenantResponse(await this.tenants.current())
  }

  @Patch()
  @RequireRole('owner')
  @ApiOperation({ summary: 'Update settings, including the dunning policy' })
  @ApiOkResponse({ type: TenantResponse })
  async update(@Body() dto: UpdateTenantDto): Promise<TenantResponse> {
    return toTenantResponse(await this.tenants.update(dto))
  }

  @Get('api-keys')
  @RequireRole('owner')
  @ApiOperation({ summary: 'List API keys (prefixes only)' })
  @ApiOkResponse({ type: [ApiKeyResponse] })
  async listKeys(): Promise<ApiKeyResponse[]> {
    return (await this.apiKeys.list(this.ctx.tenantId)).map(toApiKeyResponse)
  }

  @Delete('api-keys/:id')
  @RequireRole('owner')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiNoContentResponse()
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const revoked = await this.apiKeys.revoke(this.ctx.tenantId, id)
    if (!revoked) throw new NotFoundError('API key', id)
  }
}
