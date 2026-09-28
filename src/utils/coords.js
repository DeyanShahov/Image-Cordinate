/**
 * Coordinate maths and formatting. Pure functions only - safe to unit test in Node.
 */

/** Wrap a longitude into the -180..180 range. */
export function normalizeLongitude(longitude) {
  const wrapped = (((longitude + 180) % 360) + 360) % 360 - 180;
  return wrapped === -180 && longitude > 0 ? 180 : wrapped;
}

/** Split a decimal degree value into degrees/minutes/seconds (rounded to 0.1"). */
export function toDms(value) {
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  let minutes = Math.floor((abs - degrees) * 60);
  let seconds = Math.round(((abs - degrees) * 60 - minutes) * 60 * 10) / 10;

  if (seconds >= 60) {
    seconds -= 60;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes -= 60;
    degrees += 1;
  }
  return { degrees, minutes, seconds, negative: value < 0 };
}

/** EXIF stores coordinates as 3 rationals: degrees/1, minutes/1, seconds/10000. */
export function toExifRationals(value) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesTotal = (abs - degrees) * 60;
  const minutes = Math.floor(minutesTotal);
  const seconds = (minutesTotal - minutes) * 60;

  const denominator = 10000;
  const numerator = Math.min(Math.round(seconds * denominator), 60 * denominator - 1);
  return [
    [degrees, 1],
    [minutes, 1],
    [numerator, denominator],
  ];
}

/** Altitude (any metre value) as an EXIF rational with 2 decimals. */
export function toMetreRational(metres) {
  return [Math.round(Math.abs(metres) * 100), 100];
}

export function formatDecimal(latitude, longitude, precision = 6) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '—';
  return `${latitude.toFixed(precision)}, ${longitude.toFixed(precision)}`;
}

export function dmsString(value, positive, negative) {
  const { degrees, minutes, seconds } = toDms(value);
  const hemisphere = value >= 0 ? positive : negative;
  return `${degrees}°${String(minutes).padStart(2, '0')}'${seconds
    .toFixed(1)
    .padStart(4, '0')}"${hemisphere}`;
}

export function formatDms(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '—';
  return `${dmsString(latitude, 'N', 'S')} ${dmsString(longitude, 'E', 'W')}`;
}

/** 'good' | 'fair' | 'poor' | 'unknown' - drives the coloured accuracy dot. */
export function accuracyLevel(accuracy) {
  if (!Number.isFinite(accuracy)) return 'unknown';
  if (accuracy <= 10) return 'good';
  if (accuracy <= 50) return 'fair';
  return 'poor';
}

export function formatAccuracy(accuracy) {
  if (!Number.isFinite(accuracy)) return '—';
  return accuracy < 1 ? `±${accuracy.toFixed(1)} m` : `±${Math.round(accuracy)} m`;
}

export function formatAltitude(altitude, altitudeAccuracy) {
  if (!Number.isFinite(altitude)) return '—';
  const base = `${Math.round(altitude)} m н.в.`;
  return Number.isFinite(altitudeAccuracy)
    ? `${base} (${formatAccuracy(altitudeAccuracy)})`
    : base;
}

export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин ${seconds % 60} с`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

/** Local timestamp for EXIF DateTime: "YYYY:MM:DD HH:MM:SS". */
export function formatExifDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** GPSDateStamp is always UTC: "YYYY:MM:DD". */
export function formatExifGpsDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())}`;
}

/** GPSTimeStamp is UTC: [[h,1],[m,1],[s,1]]. */
export function formatExifGpsTime(date) {
  return [
    [date.getUTCHours(), 1],
    [date.getUTCMinutes(), 1],
    [date.getUTCSeconds(), 1],
  ];
}

export function formatDateTime(date, locale = 'bg-BG') {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    date,
  );
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function geoUri(latitude, longitude) {
  return `geo:${latitude},${longitude}`;
}

export function osmUrl(latitude, longitude, zoom = 17) {
  return (
    `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}` +
    `#map=${zoom}/${latitude}/${longitude}`
  );
}

export function googleMapsUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

/** Stable, filesystem-safe name that already carries the coordinates. */
export function makePhotoFilename(date, latitude, longitude, extension = 'jpg') {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const geo =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `_${latitude.toFixed(6)}_${longitude.toFixed(6)}`.replace(/-/g, 'm')
      : '';
  return `IMG_${stamp}${geo}.${extension}`;
}

/* ------------------------------------------------------------- navigation ---
 * Google Maps (web and app) can not read the GPS tags of a photo - it only
 * understands text, links, Plus Codes and `geo:` URIs. These helpers produce
 * exactly those formats, so a received photo (or a copied string) can be turned
 * into turn-by-turn navigation in one tap.
 */

/** Google Maps parses exactly this and nothing else: "41.887234, 24.712345". */
export function plainCoordinates(latitude, longitude, precision = 6) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `${latitude.toFixed(precision)}, ${longitude.toFixed(precision)}`;
}

/** Google Maps URLs API - opens directions to the point, no API key required. */
export function googleDirectionsUrl(latitude, longitude, travelMode = 'driving') {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return (
    `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}` +
    `&travelmode=${travelMode}`
  );
}

/** Universal link for Apple Maps directions (safe fallback when the app is absent). */
export function appleMapsDirectionsUrl(latitude, longitude, travelMode = 'driving') {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  const flag = travelMode === 'walking' ? 'w' : travelMode === 'transit' ? 'r' : 'd';
  return `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=${flag}`;
}

/** Google Maps iOS app scheme (only works when the app is installed). */
export function googleMapsAppUrl(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`;
}

/** Apple Maps app scheme. */
export function appleMapsAppUrl(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `maps://?daddr=${latitude},${longitude}`;
}

/** 'ios' | 'android' | 'desktop' - drives which maps app we hand the job to. */
export function detectPlatform(userAgent = globalThis.navigator?.userAgent ?? '') {
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/android/i.test(userAgent)) return 'android';
  return 'desktop';
}

/**
 * Ordered list of URLs to try when the user taps "Навигирай".
 *
 * The caller walks the list and stops at the first URL that leaves the page (see
 * `openNavigationLinks` in main.js), which is the standard way to cope with apps
 * that may or may not be installed on the device.
 *
 * @returns {string[]}
 */
export function navigationLinks(latitude, longitude, platform = detectPlatform()) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  if (platform === 'android') {
    // `geo:` is handled by Google Maps (and offers the app chooser on Android).
    return [
      `geo:${latitude},${longitude}?q=${latitude},${longitude}`,
      googleDirectionsUrl(latitude, longitude),
    ];
  }
  if (platform === 'ios') {
    return [
      googleMapsAppUrl(latitude, longitude),
      appleMapsAppUrl(latitude, longitude),
      appleMapsDirectionsUrl(latitude, longitude),
    ];
  }
  return [googleDirectionsUrl(latitude, longitude)];
}

/**
 * Text that is worth sharing: the mobile maps apps (and chat clients) pick the
 * coordinates out of the first line, while the link works everywhere else.
 *
 * @param {{ latitude: number, longitude: number, address?: string|null,
 *           comment?: string|null, plusCode?: string|null }} options
 */
export function navigationText({ latitude, longitude, address = null, comment = null, plusCode = null } = {}) {
  const coordinates = plainCoordinates(latitude, longitude);
  if (!coordinates) return '';

  const lines = [coordinates, googleDirectionsUrl(latitude, longitude)];
  const note = plusCode ? `Plus Code: ${plusCode}` : null;
  if (note) lines.push(note);
  if (address) lines.push(address);

  const text = lines.filter(Boolean).join('\n');
  if (!comment) return text;
  const oneLine = String(comment).replace(/\s*\n+\s*/g, ' ').trim();
  return oneLine ? `${text}\n„${oneLine}“` : text;
}
