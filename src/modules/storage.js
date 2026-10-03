/**
 * IndexedDB persistence (idb-keyval) for the offline gallery and the Nominatim cache.
 * Everything stays on the device - nothing is uploaded anywhere.
 */

import { createStore, entries, get, set, del, clear } from 'idb-keyval';
import { normalizeComment } from '../utils/comment.js';
import { groupByWeekAndDay } from '../utils/date.js';

const DB_NAME = 'image-coordinate';
const PHOTO_STORE = 'photos';
const GEOCODE_STORE = 'geocode';
const GEOCODE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
/** 1 = photo + map, 2 = + comment (older records simply lack the field). */
const SCHEMA_VERSION = 2;

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
 * Fills the defaults for records written before a field existed.
 *
 * Records are self-describing, so there is no migration to run: a photo saved by
 * v1.0 (photo + map only) is read as a v2 record with an empty comment.
 *
 * @param {unknown} value
 * @returns {PhotoRecord|null}
 */
function normalizeRecord(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    comment: typeof value.comment === 'string' ? value.comment : '',
    commentUpdatedAt: Number.isFinite(value.commentUpdatedAt) ? value.commentUpdatedAt : null,
    schemaVersion: Number.isFinite(value.schemaVersion) ? value.schemaVersion : 1,
  };
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
 * // Comment field (the third element of the photo + map + comment association):
 * @property {string} comment            // '' when the user did not write one
 * @property {number|null} commentUpdatedAt
 * @property {string} exifComment        // text actually written into the JPEG (XPComment)
 * @property {number} schemaVersion      // 1 = photo + map, 2 = + comment
 * // Weather fields (schemaVersion 2):
 * @property {object|null} weather       // { temperature, humidity, source }
 * // NEW map fields:
 * @property {Blob|null} mapBlob         // WebP map image
 * @property {Blob|null} mapThumb        // Map thumbnail
 * @property {string|null} mapFilename   // "MAP_IMG_20260925_101112_41.887234_24.712345.webp"
 * @property {number|null} mapSize
 * @property {boolean} hasMap
 */

/**
 * Writes a brand new record (or overwrites one with the same id).
 *
 * Photo, mini-map and comment are stored together in this single object, which is
 * what guarantees that they can never drift apart: {@link deletePhoto} removes the
 * whole record, so all three disappear in one transaction.
 *
 * @param {PhotoRecord} record
 */
export async function savePhoto(record) {
  const target = stores();
  if (!target) throw new Error('IndexedDB не е достъпен (частен режим?).');
  const next = normalizeRecord({
    ...record,
    comment: normalizeComment(record?.comment),
    commentUpdatedAt: Number.isFinite(record?.commentUpdatedAt) ? record.commentUpdatedAt : null,
    schemaVersion: SCHEMA_VERSION,
  });
  await set(next.id, next, target.photoStore);
  return next;
}

/**
 * Updates fields of an existing record without touching the blobs.
 *
 * Used by "Запази коментара" for a photo opened from the gallery: the photo and the
 * map stay byte-identical, only the comment (and its timestamp) change.
 *
 * @param {string} id
 * @param {Partial<PhotoRecord>} patch
 * @returns {Promise<PhotoRecord|null>} the stored record, or null when it is gone
 */
export async function updatePhoto(id, patch = {}) {
  const target = stores();
  if (!target) throw new Error('IndexedDB не е достъпен (частен режим?).');
  const current = normalizeRecord(await get(id, target.photoStore));
  if (!current) return null;
  const next = normalizeRecord({
    ...current,
    ...patch,
    commentUpdatedAt: Number.isFinite(patch.commentUpdatedAt)
      ? patch.commentUpdatedAt
      : current.commentUpdatedAt,
  });
  await set(id, next, target.photoStore);
  return next;
}

/**
 * Convenience wrapper for the comment field of the review card.
 *
 * @param {string} id
 * @param {string} comment
 * @returns {Promise<PhotoRecord|null>}
 */
export async function updatePhotoComment(id, comment) {
  return updatePhoto(id, { comment: normalizeComment(comment), commentUpdatedAt: Date.now() });
}

export async function listPhotos() {
  const target = stores();
  if (!target) return [];
  const items = await entries(target.photoStore);
  return items
    .map(([, value]) => normalizeRecord(value))
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
  return normalizeRecord(await get(id, target.photoStore));
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
