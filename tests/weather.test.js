/**
 * Unit tests for the weather helpers.
 */

import { describe, expect, it, vi } from 'vitest';

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

// fetchWeather is integration-tested indirectly; here we only verify the shape
// by mocking a successful response.
describe('fetchWeather (mocked)', () => {
  it('parses a valid Open-Meteo response', async () => {
    const mockResponse = {
      current_weather: { temperature: 22.7 },
      current: { relative_humidity: 58 },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await fetchWeather(42.6977, 23.3219, new Date());
    expect(result).toEqual({ temperature: 22.7, humidity: 58, source: 'open-meteo' });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    global.fetch.mockRestore();
  });

  it('returns null on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await fetchWeather(0, 0, new Date());
    expect(result).toBeNull();
    global.fetch.mockRestore();
  });

  it('returns null on non-ok HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await fetchWeather(0, 0, new Date());
    expect(result).toBeNull();
    global.fetch.mockRestore();
  });
});