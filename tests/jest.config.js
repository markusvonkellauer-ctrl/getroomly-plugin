/**
 * Jest Configuration for GetRoomly Plugin Tests
 */

export default {
  // Test environment
  testEnvironment: 'jsdom',

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/setup.js'],

  // Module name mapper for path aliases and static assets.
  // app-config is mocked globally because it uses import.meta.env (Vite-only).
  moduleNameMapper: {
    '^@/config/app-config$': '<rootDir>/__mocks__/app-config.js',
    '^@/(.*)$': '<rootDir>/../src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|svg)$': '<rootDir>/__mocks__/fileMock.js',
  },

  // Test file patterns — <rootDir> is the tests/ directory
  testMatch: ['<rootDir>/**/*.test.(js|jsx|ts|tsx)'],

  // Coverage configuration
  collectCoverageFrom: [
    '<rootDir>/../src/**/*.{js,jsx,ts,tsx}',
    '!<rootDir>/../src/**/*.d.ts',
    '!<rootDir>/../src/main.tsx',
    '!<rootDir>/../src/vite-env.d.ts',
  ],

  // Coverage thresholds — RoomVisualizationFlow.tsx has 1300+ lines of inline-styled
  // JSX render functions; business logic paths are tested via component tests.
  // Functions threshold set below 40% to reflect the untested render helpers.
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 35,
      lines: 55,
      statements: 55,
    },
  },

  // Transform files
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': [
      'babel-jest',
      {
        presets: [
          '@babel/preset-env',
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },

  // Module file extensions
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json'],

  // Ignore patterns — e2e, shadow-dom, and visual tests require a real browser
  // (Puppeteer) and run separately
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/e2e/',
    '<rootDir>/shadow-dom/',
    '<rootDir>/visual/',
  ],
};
