import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'

import { RequireRole } from '../auth/decorators.js'
import {
  CreatedWebhookEndpointResponse,
  CreateWebhookEndpointDto,
  WebhookDeliveryResponse,
  WebhookEndpointResponse,
} from './dto/webhook.dto.js'
import { toDeliveryResponse, toEndpointResponse, WebhooksService } from './webhooks.service.js'

@ApiTags('Webhooks')
@ApiBearerAuth('api-key')
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  @RequireRole('owner')
  @ApiOperation({ summary: 'Register an endpoint; the signing secret is returned once' })
  @ApiCreatedResponse({ type: CreatedWebhookEndpointResponse })
  async create(@Body() dto: CreateWebhookEndpointDto): Promise<CreatedWebhookEndpointResponse> {
    const endpoint = await this.webhooks.create(dto)
    return { ...toEndpointResponse(endpoint), secret: endpoint.secret }
  }

  @Get()
  @RequireRole('owner')
  @ApiOperation({ summary: 'List endpoints' })
  @ApiOkResponse({ type: [WebhookEndpointResponse] })
  async list(): Promise<WebhookEndpointResponse[]> {
    return (await this.webhooks.list()).map(toEndpointResponse)
  }

  @Delete(':id')
  @RequireRole('owner')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an endpoint and its delivery history' })
  @ApiNoContentResponse()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.webhooks.remove(id)
  }

  @Get(':id/deliveries')
  @RequireRole('owner')
  @ApiOperation({ summary: 'The last hundred deliveries to an endpoint, newest first' })
  @ApiOkResponse({ type: [WebhookDeliveryResponse] })
  async deliveries(@Param('id', ParseUUIDPipe) id: string): Promise<WebhookDeliveryResponse[]> {
    return (await this.webhooks.deliveries(id)).map(toDeliveryResponse)
  }
}
