import { Injectable } from '@nestjs/common'

import { ConflictError, NotFoundError } from '../common/errors.js'
import { clampLimit, decodeCursor, encodeCursor, type Page } from '../common/pagination.js'
import { Invoice } from '../invoices/invoice.entity.js'
import { TenantContext } from '../tenancy/tenant-context.js'
import { Customer } from './customer.entity.js'
import type {
  CreateCustomerDto,
  CustomerResponse,
  ListQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js'

export function toCustomerResponse(customer: Customer): CustomerResponse {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    address: customer.address,
    vatId: customer.vatId,
    paymentTermsDays: customer.paymentTermsDays,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  }
}

@Injectable()
export class CustomersService {
  constructor(private readonly ctx: TenantContext) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const repo = this.ctx.repo(Customer)
    return repo.save(
      repo.create({
        tenantId: this.ctx.tenantId,
        name: dto.name,
        email: dto.email ?? null,
        address: dto.address ?? null,
        vatId: dto.vatId ?? null,
        paymentTermsDays: dto.paymentTermsDays ?? null,
      }),
    )
  }

  async get(id: string): Promise<Customer> {
    const customer = await this.ctx.repo(Customer).findOneBy({ id })
    if (!customer) throw new NotFoundError('Customer', id)
    return customer
  }

  async list(query: ListQueryDto): Promise<Page<Customer>> {
    const limit = clampLimit(query.limit)
    const cursor = decodeCursor(query.cursor)
    const qb = this.ctx
      .repo(Customer)
      .createQueryBuilder('c')
      .orderBy('c.created_at', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(limit + 1)
    if (cursor) {
      qb.where('(c.created_at, c.id) < (:createdAt, :id)', cursor)
    }
    const rows = await qb.getMany()
    const items = rows.slice(0, limit)
    const last = items.at(-1)
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    }
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.get(id)
    if (dto.name !== undefined) customer.name = dto.name
    if (dto.email !== undefined) customer.email = dto.email
    if (dto.address !== undefined) customer.address = dto.address
    if (dto.vatId !== undefined) customer.vatId = dto.vatId
    if (dto.paymentTermsDays !== undefined) customer.paymentTermsDays = dto.paymentTermsDays
    return this.ctx.repo(Customer).save(customer)
  }

  /** Customers with invoices are part of the books and cannot be deleted. */
  async remove(id: string): Promise<void> {
    const customer = await this.get(id)
    const invoices = await this.ctx.repo(Invoice).countBy({ customerId: id })
    if (invoices > 0) {
      throw new ConflictError(
        'customer_has_invoices',
        `Customer ${id} has ${invoices} invoice(s) and cannot be deleted`,
      )
    }
    await this.ctx.repo(Customer).remove(customer)
  }
}
