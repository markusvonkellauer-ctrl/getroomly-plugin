/**
 * AI Generation Service Tests
 *
 * Tests the AI room visualization generation functionality
 */

import { generateRoomVisualization, validateImageFile } from '../../src/services/ai-generation';

// Mock fetch for API calls
global.fetch = jest.fn();

describe('AI Generation Service', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('validateImageFile', () => {
    test('accepts valid JPEG file', () => {
      const validFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
      Object.defineProperty(validFile, 'size', { value: 1024 * 1024 }); // 1MB

      const result = validateImageFile(validFile);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('accepts valid PNG file', () => {
      const validFile = new File([''], 'test.png', { type: 'image/png' });
      Object.defineProperty(validFile, 'size', { value: 1024 * 1024 });

      const result = validateImageFile(validFile);
      expect(result.isValid).toBe(true);
    });

    test('rejects file too large', () => {
      const largeFile = new File([''], 'large.jpg', { type: 'image/jpeg' });
      Object.defineProperty(largeFile, 'size', { value: 15 * 1024 * 1024 }); // 15MB

      const result = validateImageFile(largeFile);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('File size too large');
    });

    test('rejects invalid file type', () => {
      const invalidFile = new File([''], 'test.txt', { type: 'text/plain' });

      const result = validateImageFile(invalidFile);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid file type');
    });
  });

  describe('generateRoomVisualization', () => {
    test('successfully generates visualization', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({
          imageUrl: 'https://example.com/generated-image.jpg'
        })
      };
      fetch.mockResolvedValueOnce(mockResponse);

      const testFile = new File(['test'], 'room.jpg', { type: 'image/jpeg' });
      const params = {
        imageBlob: testFile,
        coordinates: { x: 50, y: 75, percentageX: 50, percentageY: 75 },
        productInfo: { name: 'Test Chair', category: 'Furniture' }
      };

      const result = await generateRoomVisualization(params);
      expect(result.imageUrl).toBe('https://example.com/generated-image.jpg');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('handles API error gracefully', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      };
      fetch.mockResolvedValueOnce(mockResponse);

      const testFile = new File(['test'], 'room.jpg', { type: 'image/jpeg' });
      const params = {
        imageBlob: testFile,
        coordinates: { x: 50, y: 75, percentageX: 50, percentageY: 75 },
        productInfo: { name: 'Test Chair', category: 'Furniture' }
      };

      await expect(generateRoomVisualization(params)).rejects.toThrow('Failed to generate visualization');
    });

    test('handles network error', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const testFile = new File(['test'], 'room.jpg', { type: 'image/jpeg' });
      const params = {
        imageBlob: testFile,
        coordinates: { x: 50, y: 75, percentageX: 50, percentageY: 75 },
        productInfo: { name: 'Test Chair', category: 'Furniture' }
      };

      await expect(generateRoomVisualization(params)).rejects.toThrow('Network error');
    });
  });
});