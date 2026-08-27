/**
 * Jest Test Setup
 */

import '@testing-library/jest-dom';

// Everything below mocks jsdom globals (window, URL, IntersectionObserver, ...)
// that only exist under the default `testEnvironment: 'jsdom'`. Puppeteer-based
// tests (tests/visual, tests/e2e, tests/shadow-dom) opt into
// `@jest-environment node` per-file, because jsdom's environment patching
// interferes with Puppeteer's own Node networking/process handling badly
// enough to hang page operations — under that environment there is no
// `window` at all, so this file must be a no-op rather than crash on setup.
if (typeof window !== 'undefined') {
  // Mock window.GetRoomlyEmbedConfig for tests
  global.window.GetRoomlyEmbedConfig = {
    productImage: 'https://example.com/test-product.jpg',
    sku: 'TEST-001',
    productName: 'Test Product',
    productPrice: 9999,
    category: 'Test Category',
    language: 'en',
    measurements: {
      width: 100,
      height: 80,
      depth: 60,
    },
    styling: {
      backgroundColor: '#007bff',
      color: 'white',
    },
    callbacks: {
      onModalOpen: jest.fn(),
      onModalClose: jest.fn(),
      onImageGenerated: jest.fn(),
    },
  };

  // Mock fetch for API calls
  global.fetch = jest.fn();

  // Mock file reader
  global.FileReader = class {
    constructor() {
      this.readAsDataURL = jest.fn(() => {
        this.result = 'data:image/jpeg;base64,mockedBase64';
        if (this.onload) this.onload();
      });
    }
  };

  // Mock URL.createObjectURL
  global.URL.createObjectURL = jest.fn(() => 'mocked-object-url');
  global.URL.revokeObjectURL = jest.fn();

  // Mock IntersectionObserver
  global.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Suppress console warnings in tests
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  if (args[0]?.includes('ReactDOM.render is no longer supported')) {
    return;
  }
  originalConsoleWarn.call(console, ...args);
};
