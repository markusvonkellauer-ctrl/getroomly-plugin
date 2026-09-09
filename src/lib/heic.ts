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
 * (heic2any) — dynamically imported so the vast majority of uploads
 * (already JPEG/PNG/WebP) never pay for its ~1.3MB minified size. Vite
 * code-splits this into its own chunk (see vite.config.ts's
 * chunkFileNames); the plugin's nginx config has a matching allowlist entry
 * so that chunk is actually servable in production, not just in local
 * builds — see Dockerfile.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any');
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
  const blob = Array.isArray(result) ? result[0] : result;
  const name = `${file.name.replace(/\.[^.]+$/, '')}.jpg`;
  return new File([blob], name, { type: 'image/jpeg' });
}
