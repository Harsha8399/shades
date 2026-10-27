/**
 * Jest configuration for the TypeScript engine.
 *
 * Tests live in `tests/` (excluded from the `tsc` build via tsconfig.json)
 * and use ts-jest so no separate compilation step is required.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/indicators/**/*.ts',
    'src/core/**/*.ts',
    'src/data/CSVLoader.ts',
    'src/patterns/**/*.ts',
  ],
  // The SQLite-backed repository writes to disk; keep tests hermetic.
  setupFiles: ['<rootDir>/tests/setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/cleanup.ts'],
};
