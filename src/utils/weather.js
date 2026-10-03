/**
 * Weather helpers — fetches current temperature & humidity for a coordinate.
 *
 * Uses Open-Meteo (https://open-meteo.com) – no API key, CORS-friendly,
 * free for non-commercial use. Pure functions where possible for unit testing.
 */

/** Open-Meteo endpoint for current weather. */
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/** Request timeout (ms) – fail fast so the photo flow never blocks. */
const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetches the current temperature (°C) and relative humidity (%) for a coordinate.
 *
 * Note: the modern `current=` API is required - the legacy `current_weather=true`
 * response does not contain humidity at all.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{ temperature: number, humidity: number, source: string }|null>}
 */
export async function fetchWeather(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,relative_humidity_2m',
      timezone: 'auto',
    });

    const response = await fetch(`${OPEN_METEO_URL}?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[weather] Open-Meteo responded with', response.status);
      return null;
    }

    const data = await response.json();
    const current = data.current ?? null;
    // Keep reading the legacy shape as a fallback, in case the API changes back.
    const legacy = data.current_weather ?? null;

    const temperature = Number(current?.temperature_2m ?? legacy?.temperature);
    const humidity = Number(current?.relative_humidity_2m ?? legacy?.relative_humidity);

    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return null;

    return { temperature, humidity, source: 'open-meteo' };
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn('[weather] fetch failed:', error.message);
    }
    clearTimeout(timeoutId);
    return null;
  }
}

/** @returns {string} e.g. "23°C" */
export function formatTemperature(celsius) {
  return Number.isFinite(celsius) ? `${Math.round(celsius)}°C` : '—';
}

/** @returns {string} e.g. "65%" */
export function formatHumidity(percent) {
  return Number.isFinite(percent) ? `${Math.round(percent)}%` : '—';
}

/** @returns {boolean} true when both values are present */
export function hasWeather(data) {
  return Boolean(data && Number.isFinite(data.temperature) && Number.isFinite(data.humidity));
}

/**
 * One-line weather string for the watermark / meta list.
 * @returns {string} e.g. "🌡️ 23°C · 💧 65%"
 */
export function weatherLine(data) {
  if (!hasWeather(data)) return '';
  return `🌡️ ${formatTemperature(data.temperature)} · 💧 ${formatHumidity(data.humidity)}`;
}