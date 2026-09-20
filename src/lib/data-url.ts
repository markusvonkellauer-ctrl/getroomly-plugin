// Decodes a base64 `data:` URI into a Blob synchronously — no `fetch`/
// `await` involved. Used so a download triggered from a click handler can
// call link.click() within the same synchronous task as the user gesture:
// awaiting `fetch()` first resumes in a later task on iOS Safari, which can
// lose the transient user activation a download needs, on exactly the
// platform this is meant to fix. Returns null for anything that isn't a
// well-formed base64 data: URI (this app's own images always are one — see
// ai-generation.ts — so this only returns null for a future/unexpected URL
// shape, or a malformed/truncated payload), so the caller can fall back to
// using the original URL directly instead of the exception escaping into
// the click handler and skipping its own fallback/cleanup logic.
// atob() implements the WHATWG "forgiving-base64" decode: it accepts an
// unpadded payload as long as the remaining length isn't 1 mod 4, so a
// payload truncated to a length of 2 or 3 mod 4 decodes "successfully"
// into truncated (wrong) bytes instead of throwing. Requiring canonical
// form (proper padding, length a multiple of 4, valid alphabet) up front
// catches that class of truncation before atob gets a chance to be lenient
// about it — verified empirically that atob accepts exactly the lengths
// this rejects. It can't catch every possible truncation (a prefix that
// happens to still be a valid multiple of 4 is indistinguishable from a
// genuine short payload from the string alone), but our own images are
// always canonically-padded base64 (see ai-generation.ts), so this adds a
// real check with no cost to the real path.
const CANONICAL_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) {
    return null;
  }
  const [, mimeType, base64] = match;
  if (base64.length % 4 !== 0 || !CANONICAL_BASE64_PATTERN.test(base64)) {
    return null;
  }
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}

// generateRoomVisualization's backend response can hand back any of these
// (see ai-generation.ts's blobToInline/urlToInline) -- named per a Blob's
// own .type, not assumed, so a shared image's filename extension always
// matches what's actually inside it. 'jpg', not 'jpeg': matches the
// extension triggerDownload already uses in RoomVisualizationFlow.tsx.
const MIME_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Falls back to 'jpg' -- the backend's own default format (see ai-generation.ts) -- for a MIME type not in the table above, rather than an extension-less or "undefined" filename. */
export function extensionForMimeType(mimeType: string): string {
  return MIME_TYPE_EXTENSIONS[mimeType] ?? 'jpg';
}
