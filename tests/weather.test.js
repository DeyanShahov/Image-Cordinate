/**
 * Unit tests for the weather helpers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWeather,
  formatTemperature,
  formatHumidity,
  hasWeather,
  weatherLine,
} from '../src/utils/weather.js';

describe('formatTemperature', () => {
  it('rounds and appends °C', () => {
    expect(formatTemperature(23.4)).toBe('23°C');
    expect(formatTemperature(23.6)).toBe('24°C');
    expect(formatTemperature(-5.2)).toBe('-5°C');
  });

  it('returns fallback for non-numbers', () => {
    expect(formatTemperature(Number.NaN)).toBe('—');
    expect(formatTemperature(null)).toBe('—');
    expect(formatTemperature('abc')).toBe('—');
  });
});

describe('formatHumidity', () => {
  it('rounds and appends %', () => {
    expect(formatHumidity(65.2)).toBe('65%');
    expect(formatHumidity(65.6)).toBe('66%');
  });

  it('returns fallback for non-numbers', () => {
    expect(formatHumidity(Number.NaN)).toBe('—');
    expect(formatHumidity(null)).toBe('—');
  });
});

describe('hasWeather', () => {
  it('is true only when both values are finite numbers', () => {
    expect(hasWeather({ temperature: 20, humidity: 60 })).toBe(true);
    expect(hasWeather({ temperature: 20, humidity: Number.NaN })).toBe(false);
    expect(hasWeather({ temperature: Number.NaN, humidity: 60 })).toBe(false);
    expect(hasWeather(null)).toBe(false);
    expect(hasWeather({})).toBe(false);
  });
});

describe('weatherLine', () => {
  it('formats the emoji line', () => {
    expect(weatherLine({ temperature: 23.4, humidity: 65.6 })).toBe('🌡️ 23°C · 💧 66%');
  });

  it('returns empty string when data is missing', () => {
    expect(weatherLine(null)).toBe('');
    expect(weatherLine({ temperature: 20 })).toBe('');
    expect(weatherLine({ humidity: 50 })).toBe('');
  });
});

// fetchWeather talks to Open-Meteo; the network is stubbed so the parsing rules
// (and the fail-open behaviour) are what gets tested.
describe('fetchWeather (mocked)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the modern current= response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ current: { temperature_2m: 22.7, relative_humidity_2m: 58 } }),
      }),
    );

    const result = await fetchWeather(42.6977, 23.3219);
    expect(result).toEqual({ temperature: 22.7, humidity: 58, source: 'open-meteo' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // `current=` must be requested - `current_weather=true` carries no humidity.
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain('current=temperature_2m');
  });

  it('still understands the legacy current_weather shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            current_weather: { temperature: 19.4 },
            current: { relative_humidity_2m: 71 },
          }),
      }),
    );

    const result = await fetchWeather(42.6977, 23.3219);
    expect(result).toEqual({ temperature: 19.4, humidity: 71, source: 'open-meteo' });
  });

  it('returns null when a value is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ current: { temperature_2m: 22.7 } }),
      }),
    );

    const result = await fetchWeather(42.6977, 23.3219);
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await fetchWeather(0, 0);
    expect(result).toBeNull();
  });

  it('returns null on non-ok HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await fetchWeather(0, 0);
    expect(result).toBeNull();
  });

  it('returns null without usable coordinates and never calls the API', async () => {
    vi.stubGlobal('fetch', vi.fn());

    expect(await fetchWeather(Number.NaN, 24)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});