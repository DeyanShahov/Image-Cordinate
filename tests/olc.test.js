/**
 * Unit tests for the Open Location Code ("Plus Code") encoder.
 *
 * The first test is the reference example from the specification, which is what makes
 * this implementation trustworthy without a runtime to check it against.
 */

import { describe, expect, it } from 'vitest';

import { decodeOlc, encodeOlc, OLC_ALPHABET } from '../src/utils/olc.js';

/** One cell of a full 10 character code is 0.000125 degrees; the centre is half of it. */
const HALF_CELL = 0.0000625;

const ALPHABET_RE = new RegExp(`^[${OLC_ALPHABET}]{8}\\+[${OLC_ALPHABET}]{2}$`);

describe('encodeOlc', () => {
  it('reproduces the reference example from the specification', () => {
    expect(encodeOlc(47.36559, 8.524997)).toBe('8FVC9G8F+6X');
  });

  it('starts with the known grid prefix for real places', () => {
    expect(encodeOlc(42.6977, 23.3219)).toMatch(/^8G/); // Sofia
    expect(encodeOlc(51.5, -0.1)).toMatch(/^9C/); // London
  });

  it('always returns 8 characters, a separator and 2 more', () => {
    for (const [lat, lng] of [
      [0, 0],
      [-90, -180],
      [90, 180],
      [-33.92487, 18.424055],
      [41.887234, 24.712345],
      [64.1466, -21.9426],
    ]) {
      const code = encodeOlc(lat, lng);
      expect(code).toMatch(ALPHABET_RE);
      expect(code).toHaveLength(11);
      expect(code[8]).toBe('+');
    }
  });

  it('returns an empty string for unusable input', () => {
    expect(encodeOlc(Number.NaN, 0)).toBe('');
    expect(encodeOlc(0, Number.NaN)).toBe('');
    expect(encodeOlc()).toBe('');
    expect(encodeOlc('41', '24')).toBe('');
  });

  it('clamps latitudes outside the valid range instead of throwing', () => {
    expect(encodeOlc(120, 0)).toBe(encodeOlc(90, 0));
    expect(encodeOlc(-120, 0)).toBe(encodeOlc(-90, 0));
  });
});

describe('decodeOlc', () => {
  it('returns the centre of the cell the code points at', () => {
    const decoded = decodeOlc('8FVC9G8F+6X');
    expect(decoded).not.toBeNull();
    expect(Math.abs(decoded.latitude - 47.36559)).toBeLessThanOrEqual(HALF_CELL);
    expect(Math.abs(decoded.longitude - 8.524997)).toBeLessThanOrEqual(HALF_CELL);
  });

  it('round-trips a spread of coordinates', () => {
    for (const [lat, lng] of [
      [0, 0],
      [41.887234, 24.712345],
      [-33.92487, 18.424055],
      [64.1466, -21.9426],
      [-89.9, 179.9],
    ]) {
      const decoded = decodeOlc(encodeOlc(lat, lng));
      expect(decoded).not.toBeNull();
      // A point can sit exactly on a cell edge, hence the tiny epsilon.
      expect(Math.abs(decoded.latitude - lat)).toBeLessThanOrEqual(HALF_CELL + 1e-9);
      expect(Math.abs(decoded.longitude - lng)).toBeLessThanOrEqual(HALF_CELL + 1e-9);
    }
  });

  it('is case and space tolerant', () => {
    expect(decodeOlc(' 8fvc9g8f+6x ')).toEqual(decodeOlc('8FVC9G8F+6X'));
  });

  it('refuses short codes (they need a reference location) and junk', () => {
    expect(decodeOlc('9G8F+6X')).toBeNull();
    expect(decodeOlc('8FVC9G8F-6X')).toBeNull();
    expect(decodeOlc('8FVC9G8F+!@')).toBeNull();
    expect(decodeOlc('')).toBeNull();
    expect(decodeOlc(null)).toBeNull();
  });
});
