/**
 * Canvas / bitmap helpers shared by the watermark and thumbnail code.
 * Prefers OffscreenCanvas when available, falls back to a DOM canvas.
 */

export async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      // Respect the EXIF orientation of camera files where supported.
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(blob);
      } catch {
        /* fall through to <img> */
      }
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Изображението не можа да бъде декодирано.'));
    };
    image.src = url;
  });
}

export function imageSize(image) {
  return {
    width: image.width ?? image.naturalWidth ?? 0,
    height: image.height ?? image.naturalHeight ?? 0,
  };
}

export function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Неуспешно кодиране на изображението.'))),
      type,
      quality,
    );
  });
}

/** Square JPEG thumbnail (cover crop) used by the gallery grid. */
export async function createThumbnail(blob, size = 320, quality = 0.75) {
  const image = await decodeImage(blob);
  const { width, height } = imageSize(image);
  if (!width || !height) throw new Error('Невалидни размери на изображението.');

  const scale = Math.max(size / width, size / height);
  const drawWidth = Math.round(width * scale);
  const drawHeight = Math.round(height * scale);

  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.drawImage(
    image,
    Math.round((size - drawWidth) / 2),
    Math.round((size - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
  if (typeof image.close === 'function') image.close();
  return canvasToBlob(canvas, 'image/jpeg', quality);
}
