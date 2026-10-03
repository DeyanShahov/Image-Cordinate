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

import { del, get, set } from 'idb-keyval';
import { stores } from './storage.js';

const INBOX_KEY = 'shared-photo';
/** A shared photo is only interesting right after the share happened. */
const MAX_AGE_MS = 1000 * 60 * 10;

/**
 * Stores a shared file (called from the service worker).
 *
 * @param {Blob} blob
 * @param {{ name?: string|null, type?: string|null }} [meta]
 * @returns {Promise<boolean>} false when IndexedDB is unavailable
 */
export async function putSharedPhoto(blob, meta = {}) {
  const { inboxStore } = stores();
  if (!inboxStore || !blob) return false;
  try {
    await set(INBOX_KEY, { at: Date.now(), blob, ...meta }, inboxStore);
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
  const { inboxStore } = stores();
  if (!inboxStore) return null;
  try {
    const entry = await get(INBOX_KEY, inboxStore);
    if (!entry?.blob) return null;
    await del(INBOX_KEY, inboxStore);
    if (Date.now() - (entry.at ?? 0) > MAX_AGE_MS) return null;
    return entry;
  } catch {
    return null;
  }
}
