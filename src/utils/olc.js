/**
 * Open Location Code ("Plus Code") - the location format Google Maps recognises
 * best: it can be typed, dictated, pasted or searched without any ambiguity.
 *
 * Implemented from the public specification (https://plus.codes, Apache-2.0 reference
 * design) with integer arithmetic in units of 1e-9 degrees, so no floating point
 * rounding can push a digit into the neighbouring cell.
 *
 * A full 10 character code (5 pairs, "8FVC9G8F+6X") resolves to a 13.9 m x 13.9 m
 * cell - more than enough to navigate to where a photo was taken.
 */

import { normalizeLongitude } from './coords.js';

export const OLC_ALPHABET = '23456789CFGHJMPQRVWX';

const SEPARATOR = '+';
/** The separator sits after the 8th character of a full code. */
const SEPARATOR_POSITION = 8;
/** 5 pairs = 10 characters = 0.000125 degrees per cell. */
const PAIR_COUNT = 5;
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];
const SCALE = 1e9;

/**
 * Encodes a coordinate into a full 10 character Plus Code.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {string} e.g. "8FVC9G8F+6X", or '' for invalid input
 */
export function encodeOlc(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';

  // Latitude 90 is the top edge of the grid: nudge it inwards so the digit stays
  // in range (the reference implementation does the same).
  let lat = Math.min(90, Math.max(-90, latitude));
  if (lat === 90) lat -= PAIR_RESOLUTIONS[PAIR_COUNT - 1];

  const latUnits = Math.round((lat + 90) * SCALE);
  const lngUnits = Math.round((normalizeLongitude(longitude) + 180) * SCALE);

  let code = '';
  for (let pair = 0; pair < PAIR_COUNT; pair += 1) {
    const resolution = PAIR_RESOLUTIONS[pair] * SCALE;
    const latIndex = Math.floor(latUnits / resolution) % 20;
    const lngIndex = Math.floor(lngUnits / resolution) % 20;
    if (pair * 2 === SEPARATOR_POSITION) code += SEPARATOR;
    code += OLC_ALPHABET[latIndex] + OLC_ALPHABET[lngIndex];
  }
  return code;
}

/**
 * Inverse of {@link encodeOlc}: returns the centre of the cell a full code points
 * at. Short codes ("9G8F+6W") need a reference location to be resolved, so they
 * return null - the app only ever produces full codes.
 *
 * @param {string} code
 * @returns {{ latitude: number, longitude: number }|null}
 */
export function decodeOlc(code) {
  const cleaned = String(code ?? '')
    .toUpperCase()
    .replace(/\s+/g, '');
  const separatorAt = cleaned.indexOf(SEPARATOR);
  // A full code always has 8 characters before the separator.
  if (separatorAt !== SEPARATOR_POSITION) return null;

  const digits = cleaned.replace(SEPARATOR, '');
  const pairs = Math.min(Math.floor(digits.length / 2), PAIR_COUNT);
  if (pairs < 4) return null;

  let latUnits = 0;
  let lngUnits = 0;
  let resolution = 0;
  for (let pair = 0; pair < pairs; pair += 1) {
    const latIndex = OLC_ALPHABET.indexOf(digits[pair * 2]);
    const lngIndex = OLC_ALPHABET.indexOf(digits[pair * 2 + 1]);
    if (latIndex < 0 || lngIndex < 0) return null;
    resolution = PAIR_RESOLUTIONS[pair] * SCALE;
    latUnits += latIndex * resolution;
    lngUnits += lngIndex * resolution;
  }

  return {
    latitude: (latUnits + resolution / 2) / SCALE - 90,
    longitude: normalizeLongitude((lngUnits + resolution / 2) / SCALE - 180),
  };
}
