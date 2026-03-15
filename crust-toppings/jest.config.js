/** @type {import('jest').Config} */
export default {
  preset:           'ts-jest',
  testEnvironment:  'jsdom',
  setupFilesAfterEach: ['@testing-library/jest-dom'],
  moduleNameMapper: {
    '\\.module\\.css$': '<rootDir>/src/__mocks__/styleMock.cjs',
    '\\.css$':          '<rootDir>/src/__mocks__/styleMock.cjs',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM:    true,
      tsconfig:  { jsx: 'react-jsx' },
    }],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  coverageThreshold: {
    global: { lines: 70 },
  },
};
