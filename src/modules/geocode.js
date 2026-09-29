/**
 * Reverse geocoding through the public Nominatim service.
 *
 * Usage policy compliance (https://operations.osmfoundation.org/policies/nominatim/):
 *   - max 1 request per second -> the calls are serialised through a queue
 *   - results are cached (memory + IndexedDB, 30 days) so a re-visit costs nothing
 *   - the OSM attribution stays visible in the UI
 *
 * For production traffic, self-host Nominatim or use a paid provider.
 */

import { getCachedGeocode, setCachedGeocode } from './storage.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const MIN_INTERVAL_MS = 1200;

const memory = new Map();
let chain = Promise.resolve();
let lastRequestAt = 0;

export function cacheKey(latitude, longitude) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialise requests so we never exceed the allowed rate. */
function enqueue(task) {
  const run = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return task();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function formatLabel(data) {
  const address = data?.address ?? {};
  const locality =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    address.state;
  const street = [address.road, address.house_number].filter(Boolean).join(' ');
  const parts = [street, locality, address.postcode, address.country].filter(Boolean);
  return parts.length ? parts.join(', ') : (data?.display_name ?? null);
}

async function fetchReverse(latitude, longitude, signal) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'de,en',
  });

  const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Nominatim отговори с ${response.status}`);

  const data = await response.json();
  return {
    label: formatLabel(data),
    displayName: data.display_name ?? null,
    address: data.address ?? null,
    placeId: data.place_id ?? null,
    attribution: '© OpenStreetMap contributors / Nominatim',
  };
}

/**
 * @returns {Promise<{label:string|null, displayName:string|null, address:object|null,
 *                    attribution:string}|null>} null when unavailable/offline
 */
export async function reverseGeocode(latitude, longitude, { signal } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const key = cacheKey(latitude, longitude);
  if (memory.has(key)) return memory.get(key);

  const cached = await getCachedGeocode(key);
  if (cached) {
    memory.set(key, cached);
    return cached;
  }

  try {
    const result = await enqueue(() => fetchReverse(latitude, longitude, signal));
    memory.set(key, result);
    void setCachedGeocode(key, result);
    return result;
  } catch {
    // Offline, rate limited or blocked: the app keeps working without an address.
    memory.set(key, null);
    return null;
  }
}

export function clearMemoryCache() {
  memory.clear();
}
