/**
 * exifr ships several builds (UMD for require/script, ESM for bundlers). Node ESM
 * and Vite resolve them differently, so the namespace is normalised once here.
 *
 * Without this, `import * as exifr from 'exifr'` can end up without the named
 * functions (`exifr.parse`, `exifr.gps`) when the UMD build is picked.
 */

import * as exifrModule from 'exifr';

export const exifr =
  typeof exifrModule.parse === 'function'
    ? exifrModule
    : (exifrModule.default ?? exifrModule);

export function hasExifr() {
  return typeof exifr?.parse === 'function' && typeof exifr?.gps === 'function';
}

export async function readGps(input) {
  if (!hasExifr()) return null;
  try {
    const gps = await exifr.gps(input);
    if (!gps || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) return null;
    return { latitude: gps.latitude, longitude: gps.longitude };
  } catch {
    return null;
  }
}

export async function readMetadata(input, pick) {
  if (!hasExifr()) return null;
  try {
    return (await exifr.parse(input, { pick })) ?? null;
  } catch {
    return null;
  }
}
