/** @type {import('jest').Config} */
module.exports = {
  // jest-expo applies babel-preset-expo and maps the tsconfig `@/*` alias automatically.
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/app'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
