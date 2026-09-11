import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Dunlin')
    .setDescription(
      'Multi-tenant invoicing, dunning and payment reconciliation. Authenticate with a tenant API key as a Bearer token; tenant creation uses the platform token.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Tenant API key' }, 'api-key')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Platform-Token' }, 'platform')
    .build()
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controller, method) => method,
  })
}

export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: 'Dunlin API',
  })
}
