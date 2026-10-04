/**
 * IndexedDB persistence for the offline gallery and the Nominatim cache.
 * Everything stays on the device - nothing is uploaded anywhere.
 *
 * Uses the small `idb` wrapper so the database is opened with a **version** and an
 * `upgrade` callback - that is what creates the stores on first run and adds the
 * `inbox` store to databases created by older releases.
 */

import { openDB } from 'idb';

import { normalizeComment } from '../utils/comment.js';
import { groupByWeekAndDay } from '../utils/date.js';

/** Shared with the service worker (inbox.js) so both open the same version. */
export const DB_NAME = 'image-coordinate';
/** Bumped whenever the store list changes - this is what triggers the repair below. */
export const DB_VERSION = 5;

const PHOTO_STORE = 'photos';
const GEOCODE_STORE = 'geocode';
const INBOX_STORE = 'inbox';
const GEOCODE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
/** Record shape version: 1 = photo + map, 2 = + comment. */
const SCHEMA_VERSION = 2;

let dbPromise = null;

/**
 * Opens (or upgrades) the database. The connection is cached, but the cached promise is
 * dropped when the browser terminates it, so the next call re-opens cleanly.
 *
 * The upgrade callback is deliberately **idempotent and version independent**: it
 * creates whatever store is missing. A database opened by an older release - or by a
 * build that created it with no stores at all - heals itself on the next open instead
 * of failing every transaction with `NotFoundError`.
 */
export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE);
        }
        if (!db.objectStoreNames.contains(GEOCODE_STORE)) {
          db.createObjectStore(GEOCODE_STORE);
        }
        if (!db.objectStoreNames.contains(INBOX_STORE)) {
          db.createObjectStore(INBOX_STORE);
        }
      },
      /** Another tab is upgrading: release our connection so it is not blocked. */
      blocking() {
        const pending = dbPromise;
        dbPromise = null;
        void pending?.then((db) => db.close()).catch(() => {});
      },
      /** We are waiting for another tab to close its older connection. */
      blocked() {
        console.warn('[storage] Изчакване на друга отворена вкладка да освободи базата…');
      },
      /** The browser closed the connection: forget it so the next call re-opens. */
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
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
    serviceInfo: value.serviceInfo && typeof value.serviceInfo === 'object' ? value.serviceInfo : null,
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
  const db = await getDb();
  const next = normalizeRecord({
    ...record,
    comment: normalizeComment(record?.comment),
    commentUpdatedAt: Number.isFinite(record?.commentUpdatedAt) ? record.commentUpdatedAt : null,
    schemaVersion: SCHEMA_VERSION,
  });
  await db.put(PHOTO_STORE, next, next.id);
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
  const db = await getDb();
  const current = normalizeRecord(await db.get(PHOTO_STORE, id));
  if (!current) return null;
  const next = normalizeRecord({
    ...current,
    ...patch,
    commentUpdatedAt: Number.isFinite(patch.commentUpdatedAt)
      ? patch.commentUpdatedAt
      : current.commentUpdatedAt,
  });
  await db.put(PHOTO_STORE, next, id);
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
  try {
    const db = await getDb();
    const items = await db.getAll(PHOTO_STORE);
    return items
      .map((value) => normalizeRecord(value))
      .filter(Boolean)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  } catch (error) {
    // A read-only path must never break the UI: an empty gallery is the safe answer.
    console.warn('[storage] listPhotos failed:', error?.message ?? error);
    return [];
  }
}

/** Returns photos grouped by week and day for gallery UI */
export async function listPhotosGrouped() {
  const photos = await listPhotos();
  return groupByWeekAndDay(photos);
}

export async function getPhoto(id) {
  try {
    const db = await getDb();
    return normalizeRecord(await db.get(PHOTO_STORE, id));
  } catch (error) {
    console.warn('[storage] getPhoto failed:', error?.message ?? error);
    return null;
  }
}

export async function deletePhoto(id) {
  const db = await getDb();
  await db.delete(PHOTO_STORE, id);
}

export async function clearPhotos() {
  const db = await getDb();
  await db.clear(PHOTO_STORE);
}

export async function countPhotos() {
  try {
    const db = await getDb();
    return await db.count(PHOTO_STORE);
  } catch {
    return 0;
  }
}

export async function getCachedGeocode(key) {
  try {
    const db = await getDb();
    const entry = await db.get(GEOCODE_STORE, key);
    if (!entry) return null;
    if (Date.now() - (entry.at ?? 0) > GEOCODE_TTL_MS) return null;
    return entry.value ?? null;
  } catch {
    return null;
  }
}

export async function setCachedGeocode(key, value) {
  if (!value) return;
  try {
    // Fire-and-forget from the geocoder, so the whole body stays inside the try.
    const db = await getDb();
    await db.put(GEOCODE_STORE, { at: Date.now(), value }, key);
  } catch {
    /* cache is best effort */
  }
}

export async function clearGeocodeCache() {
  const db = await getDb();
  await db.clear(GEOCODE_STORE);
}
