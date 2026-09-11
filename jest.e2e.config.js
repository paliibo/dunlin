import base from './jest.config.js'

/** @type {import('jest').Config} */
const config = {
  ...base,
  displayName: 'e2e',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  testTimeout: 30_000,
  // One process, one database: suites share the schema and truncate between files.
  maxWorkers: 1,
}

export default config
