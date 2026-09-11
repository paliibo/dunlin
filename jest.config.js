/** @type {import('jest').Config} */
const config = {
  displayName: 'unit',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json', diagnostics: false }],
  },
  setupFiles: ['<rootDir>/test/setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts', '!src/**/*.module.ts'],
  coverageDirectory: 'coverage',
}

export default config
