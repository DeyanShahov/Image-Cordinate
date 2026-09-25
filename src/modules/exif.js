/**
 * EXIF writing with piexif-ts (the maintained TypeScript port of piexifjs).
 *
 * Verified behaviour of the library (v2.1.0, dist/piexif.js):
 *   - dump(exifObj)            -> binary string starting with "Exif\0\0"
 *   - insert(exifBinary, jpeg) -> replaces/creates the APP1 segment, keeps pixels
 *   - load(jpegBinary)         -> { "0th", Exif, GPS, Interop, "1st", thumbnail }
 *   - Byte values  -> number or number[]
 *   - Rational     -> [numerator, denominator] or [[n, d], [n, d], ...]
 *
 * The package ships a legacy UMD bundle (no "exports" map, the "module" field
 * points at a file that does not exist), so we resolve the exports defensively.
 */

import * as piexifModule from 'piexif-ts';

import { blobToBinaryString, blobToBytes, binaryStringToBlob } from '../utils/binary.js';
import { exifr } from '../utils/exifr.js';
import { distanceMeters } from './geolocation.js';
import {
  toExifRationals,
  toMetreRational,
  formatExifDate,
  formatExifGpsDate,
  formatExifGpsTime,
} from '../utils/coords.js';

const piexif =
  typeof piexifModule.dump === 'function' ? piexifModule : (piexifModule.default ?? piexifModule);

/** Standard EXIF tag numbers (identical to the tables inside piexif). */
export const IMAGE_IFD = Object.freeze({
  ImageDescription: 270,
  Make: 271,
  Model: 272,
  Orientation: 274,
  Software: 305,
  DateTime: 306,
  Artist: 315,
});

export const EXIF_IFD = Object.freeze({
  DateTimeOriginal: 36867,
  DateTimeDigitized: 36868,
  UserComment: 37510,
  PixelXDimension: 40962,
  PixelYDimension: 40963,
});

export const GPS_IFD = Object.freeze({
  GPSVersionID: 0,
  GPSLatitudeRef: 1,
  GPSLatitude: 2,
  GPSLongitudeRef: 3,
  GPSLongitude: 4,
  GPSAltitudeRef: 5,
  GPSAltitude: 6,
  GPSTimeStamp: 7,
  GPSProcessingMethod: 27,
  GPSDateStamp: 29,
  GPSHPositioningError: 31,
});

/** GPSVersionID = 2.3.0.0 (the version every viewer understands). */
const GPS_VERSION = [2, 3, 0, 0];
const SOFTWARE = 'Image Coordinate 1.0';

export function isSupported() {
  return typeof piexif?.dump === 'function' && typeof piexif?.insert === 'function';
}

function dmsRationals(value) {
  // Prefer the local, unit-tested implementation: it stores 4 decimal places of a
  // second, while piexif's own helper rounds to 2 (≈0.3 m of error).
  if (Number.isFinite(value)) return toExifRationals(value);

  const helper = piexif?.GPSHelper;
  if (helper?.degToDmsRational) {
    try {
      return helper.degToDmsRational(value);
    } catch {
      /* fall through */
    }
  }
  return toExifRationals(Number(value) || 0);
}

/**
 * Machine readable, strictly ASCII summary stored in ImageDescription so that
 * other tools (and our own gallery) can recover the data without parsing GPS tags.
 */
export function buildDescription({ fix, capturedAt, source, address }) {
  const parts = ['Image Coordinate'];
  if (fix && Number.isFinite(fix.latitude)) {
    parts.push(`${fix.latitude.toFixed(6)},${fix.longitude.toFixed(6)}`);
    if (Number.isFinite(fix.accuracy)) parts.push(`acc=${Math.round(fix.accuracy)}m`);
    if (Number.isFinite(fix.altitude)) parts.push(`alt=${Math.round(fix.altitude)}m`);
  } else {
    parts.push('no-fix');
  }
  parts.push(capturedAt.toISOString());
  parts.push(`src=${source}`);
  if (address) parts.push('has-address');
  return parts.join(' | ');
}

function cloneExifObject(binary) {
  const empty = { '0th': {}, Exif: {}, GPS: {}, '1st': {}, thumbnail: null };
  try {
    const loaded = piexif.load(binary);
    if (!loaded || typeof loaded !== 'object') return empty;
    const cloned = { ...empty };
    for (const [key, value] of Object.entries(loaded)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) cloned[key] = { ...value };
      else cloned[key] = value;
    }
    return cloned;
  } catch {
    // Non-JPEG, no APP1 segment or an EXIF block the parser refuses: start clean.
    return empty;
  }
}

function applyTags(exifObj, { fix, capturedAt, source, address, pixelSize, resetOrientation }) {
  exifObj['0th'][IMAGE_IFD.ImageDescription] = buildDescription({
    fix,
    capturedAt,
    source,
    address,
  });
  exifObj['0th'][IMAGE_IFD.Software] = SOFTWARE;
  exifObj['0th'][IMAGE_IFD.DateTime] = formatExifDate(capturedAt);

  exifObj.Exif[EXIF_IFD.DateTimeOriginal] = formatExifDate(capturedAt);
  exifObj.Exif[EXIF_IFD.DateTimeDigitized] = formatExifDate(capturedAt);

  if (pixelSize?.width && pixelSize?.height) {
    exifObj.Exif[EXIF_IFD.PixelXDimension] = pixelSize.width;
    exifObj.Exif[EXIF_IFD.PixelYDimension] = pixelSize.height;
  }

  if (resetOrientation) exifObj['0th'][IMAGE_IFD.Orientation] = 1;

  if (fix && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)) {
    const gps = exifObj.GPS ?? (exifObj.GPS = {});
    gps[GPS_IFD.GPSVersionID] = GPS_VERSION;
    gps[GPS_IFD.GPSLatitudeRef] = fix.latitude >= 0 ? 'N' : 'S';
    gps[GPS_IFD.GPSLatitude] = dmsRationals(fix.latitude);
    gps[GPS_IFD.GPSLongitudeRef] = fix.longitude >= 0 ? 'E' : 'W';
    gps[GPS_IFD.GPSLongitude] = dmsRationals(fix.longitude);
    gps[GPS_IFD.GPSDateStamp] = formatExifGpsDate(capturedAt);
    gps[GPS_IFD.GPSTimeStamp] = formatExifGpsTime(capturedAt);

    if (Number.isFinite(fix.altitude)) {
      gps[GPS_IFD.GPSAltitudeRef] = fix.altitude < 0 ? 1 : 0;
      gps[GPS_IFD.GPSAltitude] = toMetreRational(fix.altitude);
    }
    if (Number.isFinite(fix.accuracy)) {
      gps[GPS_IFD.GPSHPositioningError] = toMetreRational(fix.accuracy);
    }
    // "ASCII\0\0\0" prefix is required by the EXIF spec for Undefined payloads.
    gps[GPS_IFD.GPSProcessingMethod] = `ASCII\x00\x00\x00GPS (${SOFTWARE})`;
  }
}

/** Some devices/libraries reject the optional Undefined payloads - retry without them. */
function dumpWithFallback(exifObj) {
  try {
    return piexif.dump(exifObj);
  } catch (firstError) {
    const GPS = exifObj.GPS ?? {};
    delete GPS[GPS_IFD.GPSProcessingMethod];
    delete exifObj.Exif?.[EXIF_IFD.UserComment];
    try {
      return piexif.dump(exifObj);
    } catch (secondError) {
      throw secondError instanceof Error ? secondError : firstError;
    }
  }
}

/**
 * Insert (or replace) the GPS/date tags of a JPEG **without touching the pixels**.
 *
 * Existing EXIF from the camera is preserved: we load the current APP1 block,
 * merge our tags into it and write it back.
 *
 * @param {Blob} blob
 * @param {{ fix?: object|null, address?: string|null, capturedAt?: Date,
 *           source?: string, pixelSize?: {width:number,height:number}|null,
 *           resetOrientation?: boolean }} options
 * @returns {Promise<{ blob: Blob, applied: boolean, gpsWritten: boolean, reason?: string,
 *                     tags?: object }>}
 */
export async function writeGeoExif(blob, options = {}) {
  const {
    fix = null,
    address = null,
    capturedAt = new Date(),
    source = 'browser',
    pixelSize = null,
    resetOrientation = false,
  } = options;

  if (!isSupported()) return { blob, applied: false, gpsWritten: false, reason: 'piexif-ts недостъпен' };
  if (blob.type && blob.type !== 'image/jpeg') {
    return {
      blob,
      applied: false,
      gpsWritten: false,
      reason: `EXIF се записва само в JPEG (получено: ${blob.type})`,
    };
  }

  const hasFix = Boolean(fix && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude));

  try {
    const binary = await blobToBinaryString(blob);
    const exifObj = cloneExifObject(binary);
    applyTags(exifObj, { fix, capturedAt, source, address, pixelSize, resetOrientation });
    const dumped = dumpWithFallback(exifObj);
    const inserted = piexif.insert(dumped, binary);
    const tagged = binaryStringToBlob(inserted, 'image/jpeg');

    return {
      blob: tagged,
      applied: true,
      gpsWritten: hasFix,
      tags: {
        description: exifObj['0th'][IMAGE_IFD.ImageDescription],
        dateTime: exifObj['0th'][IMAGE_IFD.DateTime],
        latitude: hasFix ? fix.latitude : null,
        longitude: hasFix ? fix.longitude : null,
        accuracy: hasFix && Number.isFinite(fix.accuracy) ? fix.accuracy : null,
      },
    };
  } catch (error) {
    return {
      blob,
      applied: false,
      gpsWritten: false,
      reason: error instanceof Error ? error.message : 'EXIF записът неуспешен',
    };
  }
}

/** Read the GPS tags back out of a JPEG/HEIC blob (null when absent). */
export async function gpsFromBlob(blob) {
  try {
    // exifr accepts raw bytes in every environment (browser + Node), while Blob
    // support depends on the build that got resolved.
    const gps = await exifr.gps(await blobToBytes(blob));
    if (!gps || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) return null;
    return { latitude: gps.latitude, longitude: gps.longitude };
  } catch {
    return null;
  }
}

/**
 * Correctness check for the written file: read the coordinates back and compare
 * with what we intended to write.
 */
export async function verifyGps(blob, expected = null, toleranceMetres = 2) {
  const gps = await gpsFromBlob(blob);
  if (!gps) return { verified: false, gps: null, distance: null, reason: 'няма GPS тагове' };
  if (!expected || !Number.isFinite(expected.latitude)) return { verified: true, gps, distance: null };

  const distance = distanceMeters(expected, gps);
  return {
    verified: distance <= toleranceMetres,
    gps,
    distance,
    reason: distance <= toleranceMetres ? undefined : `отклонение ${distance.toFixed(1)} m`,
  };
}

/** Everything a viewer would show, used by the review card for imported photos. */
export async function readExifSummary(blob) {
  try {
    const meta = await exifr.parse(await blobToBytes(blob), {
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
    });
    return meta ?? {};
  } catch {
    return {};
  }
}
