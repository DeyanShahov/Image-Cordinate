/**
 * Hand-off box between the service worker and the app.
 *
 * When another app on Android shares a photo with this PWA ("Сподели → Image
 * Coordinate", see `share_target` in vite.config.js) the service worker cannot run the
 * app logic - it stores the file here and redirects. The app then picks it up on
 * startup and runs the normal "read the EXIF and offer navigation" flow.
 *
 * The module is imported by `src/sw.js` as well, so it must stay free of DOM access.
 */

import { openDB } from 'idb';
import { del, get, set } from 'idb-keyval';

const INBOX_KEY = 'shared-photo';
/** A shared photo is only interesting right after the share happened. */
const MAX_AGE_MS = 1000 * 60 * 10;

async function getInboxStore() {
  const db = await openDB('image-coordinate', 4);
  return db.transaction('inbox', 'readwrite').objectStore('inbox');
}

/**
 * Stores a shared file (called from the service worker).
 *
 * @param {Blob} blob
 * @param {{ name?: string|null, type?: string|null }} [meta]
 * @returns {Promise<boolean>} false when IndexedDB is unavailable
 */
export async function putSharedPhoto(blob, meta = {}) {
  if (!blob) return false;
  try {
    const db = await openDB('image-coordinate', 4);
    await db.put('inbox', { at: Date.now(), blob, ...meta }, 'shared-photo');
    return true;
  } catch {
    return false;
  }
}

/**
 * Takes the shared photo out of the inbox (exactly once).
 *
 * @returns {Promise<{ blob: Blob, name?: string|null, type?: string|null, at: number }|null>}
 */
export async function takeSharedPhoto() {
  try {
    const db = await openDB('image-coordinate', 4);
    const entry = await db.get('inbox', 'shared-photo');
    if (!entry?.blob) return null;
    await db.delete('inbox', 'shared-photo');
    if (Date.now() - (entry.at ?? 0) > 1000 * 60 * 10) return null;
    return entry;
  } catch {
    return null;
  }
}
