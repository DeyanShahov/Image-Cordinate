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

const DB_NAME = 'image-coordinate';
const DB_VERSION = 4;
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
    const db = await openDB(DB_NAME, DB_VERSION);
    await db.put('inbox', { at: Date.now(), blob, ...meta }, INBOX_KEY);
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
    const db = await openDB(DB_NAME, DB_VERSION);
    const entry = await db.get('inbox', INBOX_KEY);
    if (!entry?.blob) return null;
    await db.delete('inbox', INBOX_KEY);
    if (Date.now() - (entry.at ?? 0) > MAX_AGE_MS) return null;
    return entry;
  } catch {
    return null;
  }
}
