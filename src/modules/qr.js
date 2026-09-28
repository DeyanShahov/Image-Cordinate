/**
 * QR codes for the review panel and for the optional burned-in watermark.
 *
 * A QR is the only way to hand the location to somebody who does not have this app:
 * they point their camera (or Google Lens) at the photo and land straight in Google
 * Maps. The encoder is `qrcode-generator` (MIT, zero dependencies) and it is loaded
 * **dynamically**, so the rest of the app keeps working when the package has not been
 * installed yet - the QR actions simply report that the encoder is unavailable.
 */

/** Error correction level: 'M' survives a printed photo and a slightly blurred scan. */
const DEFAULT_EC_LEVEL = 'M';

let encoderPromise = null;

/** Loads (once) the QR factory, or null when the package is missing. */
export async function loadQrEncoder() {
  if (!encoderPromise) {
    encoderPromise = import('qrcode-generator')
      .then((module) => {
        if (typeof module === 'function') return module;
        const factory = module?.default ?? module?.qrcode ?? null;
        return typeof factory === 'function' ? factory : null;
      })
      .catch(() => null);
  }
  return encoderPromise;
}

/**
 * Builds the module matrix of a QR code.
 *
 * @param {string} text
 * @param {{ errorCorrectionLevel?: 'L'|'M'|'Q'|'H' }} [options]
 * @returns {Promise<{ count: number, rows: number[][] }|null>} null when unavailable
 */
export async function createQrMatrix(text, { errorCorrectionLevel = DEFAULT_EC_LEVEL } = {}) {
  if (!text) return null;
  const factory = await loadQrEncoder();
  if (!factory) return null;

  try {
    // Type 0 = let the encoder pick the smallest version that fits.
    const qr = factory(0, errorCorrectionLevel);
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const rows = [];
    for (let row = 0; row < count; row += 1) {
      const line = new Array(count);
      for (let col = 0; col < count; col += 1) line[col] = qr.isDark(row, col) ? 1 : 0;
      rows.push(line);
    }
    return { count, rows };
  } catch {
    return null;
  }
}

/**
 * Paints a matrix into a 2d context. Shared by the DOM canvas (review panel) and the
 * OffscreenCanvas of the watermark, so both draw identical codes.
 *
 * @returns {boolean} whether anything was drawn
 */
export function paintQrMatrix(
  context,
  matrix,
  { x = 0, y = 0, size = 0, quietZone = 4, dark = '#000000', light = '#ffffff' } = {},
) {
  if (!context || !matrix?.count || !(size > 0)) return false;

  const moduleSize = size / (matrix.count + quietZone * 2);
  const offset = quietZone * moduleSize;

  context.fillStyle = light;
  context.fillRect(x, y, size, size);
  context.fillStyle = dark;
  for (let row = 0; row < matrix.count; row += 1) {
    for (let col = 0; col < matrix.count; col += 1) {
      if (!matrix.rows[row][col]) continue;
      context.fillRect(
        x + offset + col * moduleSize,
        y + offset + row * moduleSize,
        // Overlap a hair so no hairline gaps appear between modules.
        moduleSize + 0.5,
        moduleSize + 0.5,
      );
    }
  }
  return true;
}

/**
 * Creates a DOM canvas (not an OffscreenCanvas - this one is appended to the page)
 * with the QR code of `text`.
 *
 * @param {string} text
 * @param {{ pixelSize?: number, quietZone?: number, dark?: string, light?: string,
 *           errorCorrectionLevel?: 'L'|'M'|'Q'|'H' }} [options]
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export async function createQrCanvas(text, { pixelSize = 240, ...options } = {}) {
  const matrix = await createQrMatrix(text, options);
  if (!matrix || typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  const total = matrix.count + (options.quietZone ?? 4) * 2;
  const scale = Math.max(1, Math.floor(pixelSize / total));
  canvas.width = total * scale;
  canvas.height = total * scale;
  canvas.className = 'qr__canvas';

  const context = canvas.getContext('2d');
  if (!context) return null;
  return paintQrMatrix(context, matrix, { size: canvas.width, ...options }) ? canvas : null;
}

/**
 * The payload burned into the photo/watermark: a plain Google Maps link, so any
 * camera app that recognises QR codes can open it.
 */
export function qrPayloadFor(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `https://maps.google.com/?q=${latitude},${longitude}`;
}
