/**
 * Minimal observable store - the single source of truth for the UI.
 */

export const PHASES = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  LIVE: 'live',
  CAPTURING: 'capturing',
  REVIEW: 'review',
  ERROR: 'error',
});

export const CAMERA_STATES = Object.freeze({
  OFF: 'off',
  STARTING: 'starting',
  ON: 'on',
  ERROR: 'error',
});

export const GPS_STATES = Object.freeze({
  SEARCHING: 'searching',
  FIX: 'fix',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
});

const initialState = {
  phase: PHASES.IDLE,
  camera: CAMERA_STATES.OFF,
  gps: GPS_STATES.SEARCHING,
  /** Normalised fix of the last known position (see geolocation.js). */
  fix: null,
  /** Reverse geocoded label for the current fix. */
  address: null,
  /** Error message shown to the user. */
  error: null,
  /** Result of the last capture (photo blob, metadata, exif report). */
  result: null,
  /** Watermark toggle from the UI. */
  watermark: false,
  /** Video input devices that reported a label. */
  cameras: [],
  activeCameraId: null,
  busy: false,
};

let state = { ...initialState };
const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
  return state;
}

export function resetState() {
  return setState({ ...initialState });
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}
