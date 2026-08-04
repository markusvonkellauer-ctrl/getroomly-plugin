/**
 * AI Generation Service Tests
 */

import { generateRoomVisualization, validateImageFile } from '../../src/services/ai-generation';

global.fetch = jest.fn();

// blobToInline / compressImage use canvas + FileReader — stub them out
global.URL.createObjectURL = jest.fn(() => 'blob:mock');
global.URL.revokeObjectURL = jest.fn();

// Minimal Image stub so the createImageBitmap-unavailable fallback resolves immediately
global.Image = class {
  constructor() {
    setTimeout(() => {
      this.width = 800;
      this.height = 600;
      this.onload?.();
    }, 0);
  }
};

// Minimal createImageBitmap stub — applies "EXIF orientation" (mocked as a no-op) and
// resolves with a bitmap-like object exposing width/height/close(), same as the real API.
global.createImageBitmap = jest.fn(() =>
  Promise.resolve({ width: 800, height: 600, close: jest.fn() })
);

// Minimal canvas stub so compressImage produces a blob
const mockBlob = new Blob(['img'], { type: 'image/jpeg' });
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
  drawImage: jest.fn(),
}));
HTMLCanvasElement.prototype.toBlob = jest.fn(cb => cb(mockBlob));

// FileReader stub — returns a predictable base64 data URL
global.FileReader = class {
  readAsDataURL() {
    setTimeout(() => {
      this.result = 'data:image/jpeg;base64,dGVzdA==';
      this.onloadend?.();
    }, 0);
  }
};

const makeFile = (name = 'room.jpg') => new File(['test'], name, { type: 'image/jpeg' });

const baseParams = {
  imageBlob: makeFile(),
  productImage: 'data:image/jpeg;base64,dGVzdA==',
  productInfo: { name: 'Test Chair', category: 'Furniture' },
  apiKey: 'test-key',
};

describe('AI Generation Service', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  // ─── validateImageFile ────────────────────────────────────────────────────

  describe('validateImageFile', () => {
    test('accepts valid JPEG file', () => {
      const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'size', { value: 1024 * 1024 });
      expect(validateImageFile(file).isValid).toBe(true);
    });

    test('accepts valid PNG file', () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 1024 * 1024 });
      expect(validateImageFile(file).isValid).toBe(true);
    });

    test('rejects file that is too large', () => {
      const file = new File([''], 'large.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'size', { value: 15 * 1024 * 1024 });
      const result = validateImageFile(file);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/size too large/i);
    });

    test('rejects unsupported file type', () => {
      const file = new File([''], 'test.txt', { type: 'text/plain' });
      const result = validateImageFile(file);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/invalid file/i);
    });
  });

  // ─── generateRoomVisualization ────────────────────────────────────────────

  describe('generateRoomVisualization — request shape', () => {
    test('does NOT send coordinates in the request body', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: { data: 'dGVzdA==', mimeType: 'image/webp' } }),
      });

      await generateRoomVisualization(baseParams);

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('coordinates');
      expect(body).not.toHaveProperty('roomDimensions');
    });

    test('sends kind=placement, roomImage, and furnitureImage', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: { data: 'dGVzdA==', mimeType: 'image/webp' } }),
      });

      await generateRoomVisualization(baseParams);

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.kind).toBe('placement');
      expect(body.roomImage).toBeDefined();
      expect(body.furnitureImage).toBeDefined();
    });

    test('sends the partner API key as X-API-Key header', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: { data: 'dGVzdA==', mimeType: 'image/webp' } }),
      });

      await generateRoomVisualization({ ...baseParams, apiKey: 'partner-abc' });

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['X-API-Key']).toBe('partner-abc');
    });

    test('forwards category, productId, and dimensions when provided', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: { data: 'dGVzdA==', mimeType: 'image/webp' } }),
      });

      await generateRoomVisualization({
        ...baseParams,
        productInfo: {
          name: 'Rug',
          category: 'Carpet',
          productId: 'carpet-1',
          measurements: { width: 200, depth: 300, height: 1 },
        },
      });

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.category).toBe('Carpet');
      expect(body.productId).toBe('carpet-1');
      expect(body.dimensions).toEqual({ width: 200, height: 1, depth: 300 });
    });
  });

  describe('generateRoomVisualization — image compression (EXIF orientation)', () => {
    const makeLargeFile = () => {
      const file = new File(['test'], 'room.jpg', { type: 'image/jpeg' });
      Object.defineProperty(file, 'size', { value: 500 * 1024 });
      return file;
    };

    beforeEach(() => {
      global.createImageBitmap.mockClear();
      global.createImageBitmap.mockImplementation(() =>
        Promise.resolve({ width: 800, height: 600, close: jest.fn() })
      );
    });

    test('compresses a large image via createImageBitmap and still returns a valid result', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: { data: 'dGVzdA==', mimeType: 'image/webp' } }),
      });

      const result = await generateRoomVisualization({ ...baseParams, imageBlob: makeLargeFile() });

      expect(global.createImageBitmap).toHaveBeenCalled();
      expect(result.imageUrl).toBe('data:image/webp;base64,dGVzdA==');
    });

    test('falls back to Image() when createImageBitmap throws, and still returns a valid result', async () => {
      global.createImageBitmap.mockImplementationOnce(() =>
        Promise.reject(new Error('createImageBitmap unsupported'))
      );
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: { data: 'dGVzdA==', mimeType: 'image/webp' } }),
      });

      const result = await generateRoomVisualization({ ...baseParams, imageBlob: makeLargeFile() });

      expect(result.imageUrl).toBe('data:image/webp;base64,dGVzdA==');
    });
  });

  describe('generateRoomVisualization — response handling', () => {
    test('returns imageUrl built from backend image data', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: { data: 'dGVzdA==', mimeType: 'image/webp' } }),
      });

      const result = await generateRoomVisualization(baseParams);
      expect(result.imageUrl).toBe('data:image/webp;base64,dGVzdA==');
    });

    test('throws AIGenerationError when backend returns non-ok status', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ code: 'tooBusy', description: 'Upstream busy' }),
      });

      await expect(generateRoomVisualization(baseParams)).rejects.toMatchObject({
        name: 'AIGenerationError',
        status: 503,
      });
    });

    test('throws AIGenerationError when response contains no image data', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ image: null }),
      });

      await expect(generateRoomVisualization(baseParams)).rejects.toMatchObject({
        name: 'AIGenerationError',
        code: 'INVALID_RESPONSE',
      });
    });

    test('throws when API key is missing', async () => {
      const { apiKey: _, ...noKey } = baseParams;
      await expect(generateRoomVisualization(noKey)).rejects.toMatchObject({
        name: 'AIGenerationError',
        code: 'NO_API_KEY',
      });
    });
  });
});
