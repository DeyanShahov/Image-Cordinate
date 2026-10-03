/**
 * Hand-off box between the service worker and the app.
 *
 * When another app on Android shares a photo with this PWA ("Сподели → Image
 * Coordinate", see `share_target` in vite.config.js) the service worker cannot run the
 * app logic - it stores the file here and redirects. The app then picks it up on
 * startup and runs the normal "read the EXIF and offer navigation" flow.
 *
 * It reuses the connection factory from `storage.js` so the app and the worker always
 * open the database with the same version and the same store-repair upgrade.
 */

import { getDb } from './storage.js';

/** A shared photo is only interesting right after the share happened. */
const MAX_AGE_MS = 1000 * 60 * 10;
const INBOX_KEY = 'shared-photo';

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
    const db = await getDb();
    await db.put('inbox', { at: Date.now(), blob, ...meta }, INBOX_KEY);
    return true;
  } catch (error) {
    console.warn('[inbox] putSharedPhoto failed:', error?.message ?? error);
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
    const db = await getDb();
    const entry = await db.get('inbox', INBOX_KEY);
    if (!entry?.blob) return null;
    await db.delete('inbox', INBOX_KEY);
    if (Date.now() - (entry.at ?? 0) > MAX_AGE_MS) return null;
    return entry;
  } catch (error) {
    console.warn('[inbox] takeSharedPhoto failed:', error?.message ?? error);
    return null;
  }
}
