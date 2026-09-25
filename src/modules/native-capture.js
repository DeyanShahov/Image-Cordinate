/**
 * Hybdid capture mode: hand the job to the native camera app through
 * <input type="file" accept="image/*" capture="environment">.
 *
 * Why: iOS Safari does not implement ImageCapture and only gives a video frame,
 * so the native camera is the only way to get full-resolution stills there.
 * Bonus: the device usually writes its own GPS/date EXIF, which we read with exifr.
 */

import { exifr } from '../utils/exifr.js';

/** Open the native camera and resolve with the chosen file (or null when cancelled). */
export function pickPhotoFile(inputEl) {
  return new Promise((resolve) => {
    // Allow re-picking the same file after a cancel.
    inputEl.value = '';
    const onChange = () => {
      cleanup();
      resolve(inputEl.files?.[0] ?? null);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => {
      inputEl.removeEventListener('change', onChange);
      window.removeEventListener('focus', onCancel, true);
    };
    inputEl.addEventListener('change', onChange, { once: true });
    // `focus` fires again when the camera sheet closes without a selection.
    window.addEventListener('focus', onCancel, true);
    inputEl.click();
  });
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const [, y, mo, d, h, mi, s] = match.map(Number);
      return new Date(y, mo - 1, d, h, mi, s);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/**
 * @returns {Promise<{ gps: {latitude:number, longitude:number, altitude:number|null}|null,
 *                     takenAt: Date|null, make: string|null, model: string|null,
 *                     orientation: number|null, software: string|null,
 *                     width: number|null, height: number|null, hasExif: boolean }>}
 */
export async function readDeviceMetadata(file) {
  const [gps, meta] = await Promise.all([
    exifr.gps(file).catch(() => null),
    exifr
      .parse(file, {
        pick: [
          'Make',
          'Model',
          'Software',
          'Orientation',
          'DateTimeOriginal',
          'CreateDate',
          'GPSAltitude',
          'GPSAltitudeRef',
          'GPSHPositioningError',
          'ExifImageWidth',
          'ExifImageHeight',
        ],
      })
      .catch(() => null),
  ]);

  const gpsValid = Boolean(gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude));
  const hasExif = Boolean(meta && Object.keys(meta).length);

  return {
    gps: gpsValid
      ? {
          latitude: gps.latitude,
          longitude: gps.longitude,
          altitude: Number.isFinite(meta?.GPSAltitude) ? meta.GPSAltitude : null,
          accuracy: Number.isFinite(meta?.GPSHPositioningError)
            ? meta.GPSHPositioningError
            : null,
          source: 'device',
        }
      : null,
    takenAt: toDate(meta?.DateTimeOriginal ?? meta?.CreateDate),
    make: meta?.Make ?? null,
    model: meta?.Model ?? null,
    software: meta?.Software ?? null,
    orientation: Number.isFinite(meta?.Orientation) ? meta.Orientation : null,
    width: meta?.ExifImageWidth ?? null,
    height: meta?.ExifImageHeight ?? null,
    hasExif,
  };
}
