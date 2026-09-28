/**
 * Unit tests for the navigation helpers.
 *
 * These pin down the exact strings that Google Maps / Apple Maps / the chat apps
 * understand - a stray space or a wrong separator is the difference between a tap that
 * navigates and "не може да разчете формата".
 */

import { describe, expect, it } from 'vitest';

import {
  appleMapsAppUrl,
  appleMapsDirectionsUrl,
  detectPlatform,
  googleDirectionsUrl,
  googleMapsAppUrl,
  navigationLinks,
  navigationText,
  plainCoordinates,
} from '../src/utils/coords.js';

describe('plainCoordinates', () => {
  it('formats the one string Google Maps parses', () => {
    expect(plainCoordinates(41.887234, 24.712345)).toBe('41.887234, 24.712345');
  });

  it('keeps the hemisphere signs', () => {
    expect(plainCoordinates(-33.92487, 18.424055)).toBe('-33.924870, 18.424055');
  });

  it('respects the precision', () => {
    expect(plainCoordinates(41.887234, 24.712345, 4)).toBe('41.8872, 24.7123');
    expect(plainCoordinates(41.887234, 24.712345, 0)).toBe('42, 25');
  });

  it('returns an empty string without usable coordinates', () => {
    expect(plainCoordinates(Number.NaN, 24)).toBe('');
    expect(plainCoordinates(41, Number.POSITIVE_INFINITY)).toBe('');
    expect(plainCoordinates()).toBe('');
  });
});

describe('directions links', () => {
  it('builds the Google Maps directions URL from the Maps URLs API', () => {
    expect(googleDirectionsUrl(41.887234, 24.712345)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=41.887234,24.712345&travelmode=driving',
    );
  });

  it('builds the Apple Maps fallback link', () => {
    expect(appleMapsDirectionsUrl(41.887234, 24.712345)).toBe(
      'https://maps.apple.com/?daddr=41.887234,24.712345&dirflg=d',
    );
    expect(appleMapsDirectionsUrl(41.887234, 24.712345, 'walking')).toBe(
      'https://maps.apple.com/?daddr=41.887234,24.712345&dirflg=w',
    );
    expect(appleMapsDirectionsUrl(41.887234, 24.712345, 'transit')).toBe(
      'https://maps.apple.com/?daddr=41.887234,24.712345&dirflg=r',
    );
  });

  it('builds the app schemes', () => {
    expect(googleMapsAppUrl(41.887234, 24.712345)).toBe(
      'comgooglemaps://?daddr=41.887234,24.712345&directionsmode=driving',
    );
    expect(appleMapsAppUrl(41.887234, 24.712345)).toBe('maps://?daddr=41.887234,24.712345');
  });
});

describe('detectPlatform', () => {
  it('detects iOS', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)')).toBe('ios');
  });

  it('detects Android', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
  });

  it('falls back to desktop', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
    expect(detectPlatform('')).toBe('desktop');
  });
});

describe('navigationLinks', () => {
  it('prefers the geo: URI on Android, with the Google link as fallback', () => {
    expect(navigationLinks(41.887234, 24.712345, 'android')).toEqual([
      'geo:41.887234,24.712345?q=41.887234,24.712345',
      'https://www.google.com/maps/dir/?api=1&destination=41.887234,24.712345&travelmode=driving',
    ]);
  });

  it('tries the Google Maps app, then Apple Maps, on iOS', () => {
    expect(navigationLinks(41.887234, 24.712345, 'ios')).toEqual([
      'comgooglemaps://?daddr=41.887234,24.712345&directionsmode=driving',
      'maps://?daddr=41.887234,24.712345',
      'https://maps.apple.com/?daddr=41.887234,24.712345&dirflg=d',
    ]);
  });

  it('uses the Google link on desktop', () => {
    expect(navigationLinks(41.887234, 24.712345, 'desktop')).toEqual([
      'https://www.google.com/maps/dir/?api=1&destination=41.887234,24.712345&travelmode=driving',
    ]);
  });

  it('returns nothing without coordinates', () => {
    expect(navigationLinks(Number.NaN, 2)).toEqual([]);
  });
});

describe('navigationText', () => {
  it('puts the parseable coordinates first and the link second', () => {
    expect(navigationText({ latitude: 41.887234, longitude: 24.712345 })).toBe(
      '41.887234, 24.712345\n' +
        'https://www.google.com/maps/dir/?api=1&destination=41.887234,24.712345&travelmode=driving',
    );
  });

  it('adds the Plus Code, the address and the comment as extra lines', () => {
    expect(
      navigationText({
        latitude: 47.36559,
        longitude: 8.524997,
        plusCode: '8FVC9G8F+6X',
        address: 'Bahnhofstrasse 1, Zürich',
        comment: 'снимка\nот влака',
      }),
    ).toBe(
      [
        '47.365590, 8.524997',
        'https://www.google.com/maps/dir/?api=1&destination=47.36559,8.524997&travelmode=driving',
        'Plus Code: 8FVC9G8F+6X',
        'Bahnhofstrasse 1, Zürich',
        '„снимка от влака“',
      ].join('\n'),
    );
  });

  it('is empty without coordinates', () => {
    expect(navigationText({})).toBe('');
    expect(navigationText()).toBe('');
  });
});
