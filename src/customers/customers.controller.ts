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
  Query,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger'

import { RequireRole } from '../auth/decorators.js'
import { CustomersService, toCustomerResponse } from './customers.service.js'
import {
  CreateCustomerDto,
  CustomerResponse,
  ListQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js'

class CustomerPage {
  @ApiProperty({ type: [CustomerResponse] }) items: CustomerResponse[]
  @ApiProperty({
    nullable: true,
    description: 'Pass as ?cursor= for the next page; null on the last page',
  })
  nextCursor: string | null
}

@ApiTags('Customers')
@ApiBearerAuth('api-key')
@Controller('v1/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @RequireRole('accountant')
  @ApiOperation({ summary: 'Create a customer' })
  @ApiCreatedResponse({ type: CustomerResponse })
  async create(@Body() dto: CreateCustomerDto): Promise<CustomerResponse> {
    return toCustomerResponse(await this.customers.create(dto))
  }

  @Get()
  @ApiOperation({ summary: 'List customers, newest first' })
  @ApiOkResponse({ type: CustomerPage })
  async list(@Query() query: ListQueryDto): Promise<CustomerPage> {
    const page = await this.customers.list(query)
    return { items: page.items.map(toCustomerResponse), nextCursor: page.nextCursor }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer' })
  @ApiOkResponse({ type: CustomerResponse })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerResponse> {
    return toCustomerResponse(await this.customers.get(id))
  }

  @Patch(':id')
  @RequireRole('accountant')
  @ApiOperation({ summary: 'Update a customer' })
  @ApiOkResponse({ type: CustomerResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    return toCustomerResponse(await this.customers.update(id, dto))
  }

  @Delete(':id')
  @RequireRole('accountant')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a customer that has no invoices' })
  @ApiNoContentResponse()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.customers.remove(id)
  }
}
