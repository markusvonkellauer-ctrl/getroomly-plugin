/**
 * dataUrlToBlob / mimeTypeFromDataUrl tests
 */

import { dataUrlToBlob, mimeTypeFromDataUrl } from '../../src/lib/data-url';

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

  test('returns null (not throw) for a malformed/truncated base64 payload', () => {
    expect(dataUrlToBlob('data:image/jpeg;base64,not-valid-base64!!!')).toBeNull();
  });

  test('returns null for an empty base64 payload, instead of a bogus zero-byte Blob', () => {
    expect(dataUrlToBlob('data:image/jpeg;base64,')).toBeNull();
  });

  test('returns null for a payload truncated mid-transfer, instead of a corrupted Blob', () => {
    // The full, correct payload is 'ZmFrZS1yZXN1bHQtaW1hZ2U=' (decodes to
    // 'fake-result-image'). Truncated to 6 characters, its length is 2 mod
    // 4 -- atob() is lenient about that (per the WHATWG forgiving-base64
    // decode) and would otherwise silently decode this to a wrong,
    // truncated 'fake' instead of throwing or being rejected.
    expect(dataUrlToBlob('data:image/jpeg;base64,ZmFrZS')).toBeNull();
  });
});

describe('mimeTypeFromDataUrl', () => {
  test('reads the declared MIME type without decoding the payload', () => {
    expect(mimeTypeFromDataUrl('data:image/jpeg;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=')).toBe(
      'image/jpeg'
    );
    expect(mimeTypeFromDataUrl('data:image/webp;base64,ZmFrZS1yZXN1bHQtaW1hZ2U=')).toBe(
      'image/webp'
    );
  });

  test('never runs atob() -- returns instantly on a payload too large/malformed for atob to survive', () => {
    // A deliberately invalid base64 payload (atob() would throw on this)
    // -- if mimeTypeFromDataUrl decoded anything, this would throw instead
    // of returning cleanly, proving it only reads the header.
    expect(mimeTypeFromDataUrl('data:image/jpeg;base64,not-valid-base64!!!')).toBe('image/jpeg');
  });

  test('returns null for a plain http(s) URL', () => {
    expect(mimeTypeFromDataUrl('https://cdn.example.com/result.jpg')).toBeNull();
  });
});
