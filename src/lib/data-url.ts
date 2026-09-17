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
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) {
    return null;
  }
  const [, mimeType, base64] = match;
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
