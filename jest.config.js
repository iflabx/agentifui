// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@lib/(.*)$': '<rootDir>/lib/$1',
    '^@components/(.*)$': '<rootDir>/components/$1',
    '^@app/(.*)$': '<rootDir>/app/$1',
  },
  testEnvironment: 'jsdom',
  testMatch: [
    '**/__tests__/**/*.test.(js|jsx|ts|tsx)',
    '**/*.(test|spec).(js|jsx|ts|tsx)',
  ],
  collectCoverageFrom: [
    '**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
    '!**/coverage/**',
    '!jest.config.js',
    '!jest.setup.js',
    '!**/middleware.ts',
    '!**/next.config.ts',
    '!**/tailwind.config.js',
    '!**/ecosystem.config.js',
    '!**/postcss.config.mjs',
    '!**/scripts/**',
    '!**/__mocks__/**',
  ],
  // coverage set to 0 (temporary)
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { presets: ['next/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};

const getJestConfig = createJestConfig(customJestConfig);

module.exports = async () => ({
  ...(await getJestConfig()),
  transformIgnorePatterns: [
    '/node_modules/(?!\\.pnpm/|cookie/)',
    '/node_modules/\\.pnpm/(?!cookie@)',
    '^.+\\.module\\.(css|sass|scss)$',
  ],
});
