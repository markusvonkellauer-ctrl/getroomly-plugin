// Re-encodes an image Blob as PNG. PNG is the only image type every browser
// accepts on the async clipboard (Chrome rejects image/webp, which is what
// the backend usually returns), so "Copy image" converts before writing.
// Returns the blob itself when it already is a PNG. Uses createImageBitmap
// + a canvas, so it needs a real browser; callers should treat a rejection
// as "copy failed" and fall back to a download.
export async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') {
    return blob;
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas is unavailable');
    }
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        png => (png ? resolve(png) : reject(new Error('PNG encoding failed'))),
        'image/png'
      );
    });
  } finally {
    bitmap.close();
  }
}
