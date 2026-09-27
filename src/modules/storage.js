/**
 * IndexedDB persistence (idb-keyval) for the offline gallery and the Nominatim cache.
 * Everything stays on the device - nothing is uploaded anywhere.
 */

import { createStore, entries, get, set, del, clear } from 'idb-keyval';
import { groupByWeekAndDay } from '../utils/date.js';

const DB_NAME = 'image-coordinate';
const PHOTO_STORE = 'photos';
const GEOCODE_STORE = 'geocode';
const GEOCODE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

let photoStore = null;
let geocodeStore = null;

function stores() {
  if (photoStore && geocodeStore) return { photoStore, geocodeStore };
  if (typeof indexedDB === 'undefined') return null;
  photoStore = createStore(DB_NAME, PHOTO_STORE);
  geocodeStore = createStore(DB_NAME, GEOCODE_STORE);
  return { photoStore, geocodeStore };
}

export function isAvailable() {
  return typeof indexedDB !== 'undefined';
}

/**
 * @typedef {object} PhotoRecord
 * @property {string} id
 * @property {number} createdAt
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {number|null} accuracy
 * @property {number|null} altitude
 * @property {string|null} address
 * @property {string} source
 * @property {boolean} watermarked
 * @property {boolean} exifApplied
 * @property {boolean} gpsWritten
 * @property {string} filename           // "IMG_20260925_101112_41.887234_24.712345.jpg"
 * @property {number} size
 * @property {Blob} blob
 * @property {Blob|null} thumb
 * // NEW map fields:
 * @property {Blob|null} mapBlob         // WebP map image
 * @property {Blob|null} mapThumb        // Map thumbnail
 * @property {string|null} mapFilename   // "MAP_IMG_20260925_101112_41.887234_24.712345.webp"
 * @property {number|null} mapSize
 * @property {boolean} hasMap
 */

/** @param {PhotoRecord} record */
export async function savePhoto(record) {
  const target = stores();
  if (!target) throw new Error('IndexedDB не е достъпен (частен режим?).');
  await set(record.id, record, target.photoStore);
  return record;
}

export async function listPhotos() {
  const target = stores();
  if (!target) return [];
  const items = await entries(target.photoStore);
  return items
    .map(([, value]) => value)
    .filter(Boolean)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Returns photos grouped by week and day for gallery UI */
export async function listPhotosGrouped() {
  const photos = await listPhotos();
  return groupByWeekAndDay(photos);
}

export async function getPhoto(id) {
  const target = stores();
  if (!target) return null;
  return (await get(id, target.photoStore)) ?? null;
}

export async function deletePhoto(id) {
  const target = stores();
  if (!target) return;
  await del(id, target.photoStore);
}

export async function clearPhotos() {
  const target = stores();
  if (!target) return;
  await clear(target.photoStore);
}

export async function countPhotos() {
  const target = stores();
  if (!target) return 0;
  return (await entries(target.photoStore)).length;
}

export async function getCachedGeocode(key) {
  const target = stores();
  if (!target) return null;
  try {
    const entry = await get(key, target.geocodeStore);
    if (!entry) return null;
    if (Date.now() - (entry.at ?? 0) > GEOCODE_TTL_MS) return null;
    return entry.value ?? null;
  } catch {
    return null;
  }
}

export async function setCachedGeocode(key, value) {
  const target = stores();
  if (!target || !value) return;
  try {
    await set(key, { at: Date.now(), value }, target.geocodeStore);
  } catch {
    /* cache is best effort */
  }
}

export async function clearGeocodeCache() {
  const target = stores();
  if (!target) return;
  await clear(target.geocodeStore);
}
