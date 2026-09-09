// HEIC/HEIF is the default photo format on iPhone (unless "Most Compatible"
// is set in Camera settings), and no browser except Safari can decode it in
// <img>/createImageBitmap/canvas — Chrome, Firefox and Edge all fail
// silently. Worse, a HEIC file is often saved or shared with a `.jpeg`
// extension without ever being converted, which makes `file.type` report
// 'image/jpeg' even though the bytes are HEIC — so detection here never
// trusts the extension or MIME type, only the file's real magic bytes.

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

/**
 * Sniffs the first 12 bytes for an ISO-BMFF `ftyp` box with a HEIC/HEIF
 * brand — the same signature `file`/libheif use to identify the format,
 * regardless of what the file is named or what MIME type the browser
 * reports for it.
 */
export async function isHeicFile(file: File): Promise<boolean> {
  // FileReader, not Blob.prototype.arrayBuffer() — broader support (notably
  // jsdom in tests doesn't implement the latter).
  const header = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
  if (header.byteLength < 12) {
    return false;
  }
  const bytes = new Uint8Array(header);
  const boxType = String.fromCharCode(...bytes.slice(4, 8));
  if (boxType !== 'ftyp') {
    return false;
  }
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  return HEIC_BRANDS.has(brand);
}

/**
 * Converts a HEIC/HEIF file to a JPEG File via a lazily-loaded decoder
 * (heic-to, ~3MB minified) — dynamically imported so the vast majority of
 * uploads (already JPEG/PNG/WebP) never pay for it. Vite code-splits this
 * into its own chunk (see vite.config.ts's chunkFileNames); the plugin's
 * nginx config has a matching allowlist entry so that chunk is actually
 * servable in production, not just in local builds — see Dockerfile.
 *
 * Uses the `/csp` build specifically, not the default one: this plugin
 * embeds on arbitrary third-party host pages whose Content-Security-Policy
 * we don't control, and the default build's WASM instantiation needs
 * `unsafe-eval` — a CSP any partner site could reasonably have without it.
 *
 * heic-to over the smaller heic2any (this repo's first choice): heic2any's
 * older pure-JS/asm.js decoder failed ("ERR_LIBHEIF format not supported")
 * on a real-world HEIC photo that wasn't even an unusual variant — a plain
 * "HEIF Image HEVC Main Profile" file. heic-to wraps an actual, current
 * (1.22.2 as of writing) build of the reference libheif C library, and
 * correctly decoded that same file. Given the whole point of this module is
 * making HEIC uploads reliably work, decode success rate matters more here
 * than the larger lazy chunk.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import('heic-to/csp');
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.85 });
  const name = `${file.name.replace(/\.[^.]+$/, '')}.jpg`;
  return new File([blob], name, { type: 'image/jpeg' });
}
