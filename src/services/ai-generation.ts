import { AppConfig } from '@/config/app-config';
import type { GenerationResult } from '@/types/product';

/**
 * AI Generation Service
 *
 * Thin client for the GetRoomly Backend `/v1/generate` endpoint.
 * The backend owns:
 *  - Gemini API call + key
 *  - All prompt-building (carpet vs furniture, language lock, TINY rule, material instructions, etc.)
 *  - WebP re-encoding
 *  - Per-partner quota / rate limiting / auth
 *
 * This file only:
 *  1. Compresses the room image client-side (to stay under 20MB body limit)
 *  2. Converts images to `{data, mimeType}` shape the backend expects
 *  3. POSTs to `/v1/generate` with the partner API key
 *  4. Returns the generated image as a data URL ready for `<img src>`
 */

export interface PlacementRequest {
  imageBlob: Blob;
  productImage: string; // Product image URL or data URL
  productInfo: {
    name: string;
    category: string;
    productId?: string;
    description?: string;
    material?: string;
    measurements?: {
      width: number;
      depth: number;
      height: number;
    };
  };
  language?: 'en' | 'sv';
  /** Partner API key. Required — host pages set it via window.GetRoomlyEmbedConfig.apiKey. */
  apiKey?: string;
  /** Optional trace ID. Stored in backend RenderLog for support lookups. */
  sessionId?: string;
}

/** Draws a source (ImageBitmap or HTMLImageElement) onto a resized canvas and returns the compressed blob. */
function drawAndCompress(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  quality: number,
  originalBlob: Blob,
  resolve: (blob: Blob) => void,
  reject: (err: Error) => void
): void {
  let width = sourceWidth;
  let height = sourceHeight;

  console.log(`[DEBUG] drawAndCompress input: ${sourceWidth}x${sourceHeight} ratio=${( sourceWidth/sourceHeight).toFixed(3)}`);

  if (width > maxWidth || height > maxWidth) {
    if (width > height) {
      height = (height / width) * maxWidth;
      width = maxWidth;
    } else {
      width = (width / height) * maxWidth;
      height = maxWidth;
    }
  }

  // Round once so canvas dimensions (integer attributes) and drawImage's target size agree —
  // otherwise a fractional size gets truncated for the canvas but not for the draw, causing
  // 1px clipping/stretching.
  width = Math.round(width);
  height = Math.round(height);

  console.log(`[DEBUG] drawAndCompress canvas: ${width}x${height} ratio=${(width/height).toFixed(3)}`);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return reject(new Error('Canvas context failed'));
  }

  ctx.drawImage(source, 0, 0, width, height);
  canvas.toBlob(
    compressed => {
      if (compressed) {
        console.log(
          `[Plugin] Image compressed: ${(originalBlob.size / 1024 / 1024).toFixed(2)}MB → ${(compressed.size / 1024 / 1024).toFixed(2)}MB`
        );
        resolve(compressed);
      } else {
        resolve(originalBlob);
      }
    },
    'image/jpeg',
    quality
  );
}

/** Loads the image via `new Image()` (no EXIF orientation correction) and compresses it. */
function compressImageFallback(
  blob: Blob | File,
  maxWidth: number,
  quality: number,
  resolve: (blob: Blob) => void,
  reject: (err: Error) => void
): void {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    console.log(`[DEBUG] compressImageFallback (new Image, no EXIF): ${img.width}x${img.height} ratio=${(img.width/img.height).toFixed(3)}`);
    drawAndCompress(img, img.width, img.height, maxWidth, quality, blob, resolve, reject);
  };
  img.onerror = () => {
    URL.revokeObjectURL(img.src);
    resolve(blob);
  };
}

/** Compresses an image to stay under the backend's 20MB body limit. */
async function compressImage(blob: Blob | File, maxWidth = 1600, quality = 0.75): Promise<Blob> {
  console.log(`[DEBUG] compressImage: blob size=${(blob.size/1024/1024).toFixed(2)}MB type=${blob.type}`);

  if (blob.size < 400 * 1024) {
    console.log('[DEBUG] compressImage: blob under 400KB, skipping compression');
    return blob;
  }

  return new Promise((resolve, reject) => {
    if (typeof createImageBitmap !== 'function') {
      console.log('[DEBUG] compressImage: createImageBitmap not available, using fallback');
      return compressImageFallback(blob, maxWidth, quality, resolve, reject);
    }

    // Applies the photo's embedded EXIF orientation automatically — without this,
    // portrait photos taken directly with a phone camera get compressed sideways.
    // createImageBitmap can both reject *and* throw synchronously (e.g. unsupported
    // options), so both paths need to fall back the same way.
    try {
      createImageBitmap(blob, { imageOrientation: 'from-image' })
        .then(bitmap => {
          console.log(`[DEBUG] createImageBitmap (with EXIF): ${bitmap.width}x${bitmap.height} ratio=${(bitmap.width/bitmap.height).toFixed(3)}`);
          drawAndCompress(
            bitmap,
            bitmap.width,
            bitmap.height,
            maxWidth,
            quality,
            blob,
            compressed => {
              bitmap.close();
              resolve(compressed);
            },
            err => {
              bitmap.close();
              reject(err);
            }
          );
        })
        .catch(err => {
          console.warn('[Plugin] createImageBitmap failed, falling back to Image():', err);
          compressImageFallback(blob, maxWidth, quality, resolve, reject);
        });
    } catch (err) {
      console.warn('[Plugin] createImageBitmap threw synchronously, falling back to Image():', err);
      compressImageFallback(blob, maxWidth, quality, resolve, reject);
    }
  });
}

/** Converts a Blob/File to backend's inline image shape (base64 without data URL prefix). */
async function blobToInline(blob: Blob): Promise<{ data: string; mimeType: string }> {
  const compressed = await compressImage(blob);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return reject(new Error('Could not parse data URL'));
      }
      resolve({ mimeType: 'image/jpeg', data: match[2] });
    };
    reader.onerror = reject;
    reader.readAsDataURL(compressed);
  });
}

/** Fetches a URL (or parses a data URL) and returns it in the backend's inline image shape. */
async function urlToInline(url: string): Promise<{ data: string; mimeType: string }> {
  // Already a data URL? Parse directly.
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch product image: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const compressed = await compressImage(blob);
  return blobToInline(compressed);
}

export class AIGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'AIGenerationError';
  }
}

/** Generates a room visualization by calling the GetRoomly backend. */
export async function generateRoomVisualization(
  request: PlacementRequest
): Promise<GenerationResult> {
  const apiKey = request.apiKey || AppConfig.ai.defaultApiKey;
  if (!apiKey) {
    throw new AIGenerationError(
      'Missing GetRoomly API key. Set window.GetRoomlyEmbedConfig.apiKey to your partner key.',
      'NO_API_KEY',
      0
    );
  }

  const startTime = Date.now();

  // 1. Convert room image (blobToInline handles compression internally)
  console.log('[Plugin] Preparing room image:', request.imageBlob.size, 'bytes');
  const roomImage = await blobToInline(request.imageBlob);

  // 2. Convert product image (URL or data URL → inline)
  if (!request.productImage) {
    throw new AIGenerationError(
      'Missing product image. Set window.GetRoomlyEmbedConfig.productImage to your product image URL.',
      'NO_PRODUCT_IMAGE',
      0
    );
  }
  const furnitureImage = await urlToInline(request.productImage);

  // 3. Build the request body
  const category = request.productInfo.category;

  const body = {
    kind: 'placement' as const,
    sessionId: request.sessionId,
    language: request.language || 'en',
    roomImage,
    furnitureImage,
    category,
    productId: request.productInfo.productId,
    description: request.productInfo.description,
    material: request.productInfo.material,
    dimensions: request.productInfo.measurements && {
      width: request.productInfo.measurements.width,
      height: request.productInfo.measurements.height,
      depth: request.productInfo.measurements.depth,
    },
  };

  // 4. POST to backend
  const endpoint = `${AppConfig.api.baseUrl}/v1/generate`;
  console.log('[Plugin] Calling backend:', endpoint);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}) as Record<string, unknown>);
    const code = (err.code as string) ?? 'BACKEND_ERROR';
    const description = (err.description as string) ?? res.statusText;
    const modelResponse = (err.meta as Record<string, unknown>)?.modelResponse as
      | string
      | undefined;
    console.error(`[Plugin] Backend error ${res.status} (${code}):`, description);
    if (modelResponse) {
      console.error(`[Plugin] Model response:`, modelResponse);
    }
    throw new AIGenerationError(description, code, res.status);
  }

  const result = await res.json();
  const endTime = Date.now();

  if (!result.image?.data) {
    throw new AIGenerationError(
      'Backend response missing image data',
      'INVALID_RESPONSE',
      res.status
    );
  }

  return {
    imageUrl: `data:${result.image.mimeType};base64,${result.image.data}`,
    base64Data: result.image.data,
    prompt: '',
    latency: result.latencyMs ?? endTime - startTime,
  };
}

/** Validates uploaded image file. */
export function validateImageFile(file: File): { isValid: boolean; error?: string } {
  if (file.size > AppConfig.images.maxFileSize) {
    const maxSizeMB = AppConfig.images.maxFileSize / (1024 * 1024);
    return { isValid: false, error: `File size too large. Maximum size is ${maxSizeMB}MB.` };
  }

  if (
    !AppConfig.images.allowedFormats.includes(
      file.type as (typeof AppConfig.images.allowedFormats)[number]
    )
  ) {
    return { isValid: false, error: 'Invalid file format. Please use JPEG, PNG, or WebP.' };
  }

  return { isValid: true };
}
