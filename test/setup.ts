import 'reflect-metadata'

// The e2e suites need a real Postgres and Redis; these defaults match compose.yaml.
process.env.NODE_ENV ??= 'test'
process.env.DATABASE_URL ??= 'postgres://dunlin:dunlin@127.0.0.1:5433/dunlin_test'
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380'
process.env.PLATFORM_TOKEN ??= 'test-platform-token-not-for-anything-else'
process.env.LOG_LEVEL ??= 'silent'
process.env.WEBHOOK_BACKOFF_MS ??= '50'
process.env.MAIL_BACKOFF_MS ??= '50'
