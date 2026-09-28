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

import { createStore, del, get, set } from 'idb-keyval';

const DB_NAME = 'image-coordinate';
const INBOX_STORE = 'inbox';
const INBOX_KEY = 'shared-photo';
/** A shared photo is only interesting right after the share happened. */
const MAX_AGE_MS = 1000 * 60 * 10;

let store = null;

function inboxStore() {
  if (store) return store;
  if (typeof indexedDB === 'undefined') return null;
  store = createStore(DB_NAME, INBOX_STORE);
  return store;
}

/**
 * Stores a shared file (called from the service worker).
 *
 * @param {Blob} blob
 * @param {{ name?: string|null, type?: string|null }} [meta]
 * @returns {Promise<boolean>} false when IndexedDB is unavailable
 */
export async function putSharedPhoto(blob, meta = {}) {
  const target = inboxStore();
  if (!target || !blob) return false;
  try {
    await set(INBOX_KEY, { at: Date.now(), blob, ...meta }, target);
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
  const target = inboxStore();
  if (!target) return null;
  try {
    const entry = await get(INBOX_KEY, target);
    if (!entry?.blob) return null;
    await del(INBOX_KEY, target);
    if (Date.now() - (entry.at ?? 0) > MAX_AGE_MS) return null;
    return entry;
  } catch {
    return null;
  }
}
