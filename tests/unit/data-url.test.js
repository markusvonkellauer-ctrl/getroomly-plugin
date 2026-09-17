/**
 * dataUrlToBlob tests
 */

import { dataUrlToBlob } from '../../src/lib/data-url';

describe('dataUrlToBlob', () => {
  test('decodes a base64 data: URI into a Blob of the right type and size', () => {
    const blob = dataUrlToBlob('data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=');
    expect(blob).not.toBeNull();
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe('fake-result-image'.length);
  });

  test('returns null for a plain http(s) URL', () => {
    expect(dataUrlToBlob('https://cdn.example.com/result.jpg')).toBeNull();
  });

  test('returns null for a non-base64 data: URI', () => {
    expect(dataUrlToBlob('data:image/svg+xml,<svg></svg>')).toBeNull();
  });
});
