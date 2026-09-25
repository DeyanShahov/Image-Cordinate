/**
 * Screen Wake Lock: keeps the screen (and therefore the camera) alive while the
 * user lines up a shot. Safari iOS supports it from 16.4, Chrome from 85.
 */

let sentinel = null;
let wantsLock = false;

export function isSupported() {
  return typeof globalThis.navigator?.wakeLock?.request === 'function';
}

export async function acquireWakeLock() {
  wantsLock = true;
  if (!isSupported() || sentinel) return Boolean(sentinel);
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
    return true;
  } catch {
    sentinel = null;
    return false;
  }
}

export async function releaseWakeLock() {
  wantsLock = false;
  if (!sentinel) return;
  try {
    await sentinel.release();
  } catch {
    /* already released */
  }
  sentinel = null;
}

/**
 * Browsers release the lock whenever the page is hidden, so re-acquire it on return.
 * @returns {() => void} teardown
 */
export function keepAwakeWhileVisible() {
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && wantsLock && !sentinel) acquireWakeLock();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => document.removeEventListener('visibilitychange', onVisibilityChange);
}
