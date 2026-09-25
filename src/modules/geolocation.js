/**
 * Geolocation wrapper: one long-lived watchPosition that keeps the freshest fix,
 * plus helpers to freeze that fix at the exact moment the shutter is pressed.
 */

export const GPS_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
});

export function isSupported() {
  return typeof globalThis.navigator?.geolocation?.watchPosition === 'function';
}

/** Raw GeolocationPosition -> plain, serialisable object. */
export function toFix(position) {
  const coords = position.coords;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    altitude: coords.altitude,
    altitudeAccuracy: coords.altitudeAccuracy,
    heading: coords.heading,
    speed: coords.speed,
    timestamp: position.timestamp ?? Date.now(),
    /** When the app received the fix (position.timestamp is the measurement time). */
    receivedAt: Date.now(),
  };
}

export function startWatch({ onFix, onError, options = GPS_OPTIONS } = {}) {
  if (!isSupported()) {
    onError?.(new Error('Geolocation API не се поддържа от този браузър.'));
    return null;
  }
  return navigator.geolocation.watchPosition(
    (position) => onFix?.(toFix(position)),
    (error) => onError?.(error),
    options,
  );
}

export function stopWatch(watchId) {
  if (watchId == null) return;
  navigator.geolocation.clearWatch(watchId);
}

export function fixAgeSeconds(fix, now = Date.now()) {
  if (!fix) return null;
  return Math.max(0, (now - (fix.timestamp ?? fix.receivedAt ?? now)) / 1000);
}

/**
 * Pick the better of two fixes: first the one with the smallest accuracy,
 * then the freshest one. Used to merge a device EXIF position with a live fix.
 */
export function pickBetterFix(candidate, current) {
  if (!candidate) return current ?? null;
  if (!current) return candidate;
  const candidateAccuracy = Number.isFinite(candidate.accuracy) ? candidate.accuracy : Infinity;
  const currentAccuracy = Number.isFinite(current.accuracy) ? current.accuracy : Infinity;
  if (candidateAccuracy < currentAccuracy) return candidate;
  if (currentAccuracy < candidateAccuracy) return current;
  return (candidate.timestamp ?? 0) > (current.timestamp ?? 0) ? candidate : current;
}

/**
 * Two positions are "in conflict" when they are further apart than the combined
 * accuracy suggests - used to decide which source wins when geotagging.
 */
export function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371008.8;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
