/**
 * Leaflet + OpenStreetMap map showing where the photo was taken:
 * marker, accuracy circle and a popup with the numbers.
 */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { formatAccuracy, formatDateTime, geoUri } from '../utils/coords.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let map = null;
let marker = null;
let circle = null;
let currentContainer = null;

const pinIcon = () =>
  L.divIcon({
    className: 'map__icon',
    html: '<span class="map__pin"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  });

export function ensureMap(container) {
  if (map && currentContainer === container) return map;
  destroy();

  currentContainer = container;
  map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
    worldCopyJump: true,
    preferCanvas: true,  // Required for html2canvas to capture vector layers (markers, circles)
  });

  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: TILE_ATTRIBUTION,
  }).addTo(map);

  return map;
}

/** @param {{latitude:number, longitude:number, accuracy?:number, altitude?:number,
 *            timestamp?:number}} fix */
export function showFix(fix, { address = null, zoom = 17 } = {}) {
  if (!map || !fix) return;
  const latlng = [fix.latitude, fix.longitude];

  if (!marker) {
    marker = L.marker(latlng, { icon: pinIcon(), keyboard: false }).addTo(map);
  } else {
    marker.setLatLng(latlng);
  }

  const popupBits = [];
  if (Number.isFinite(fix.accuracy)) popupBits.push(`точност ${formatAccuracy(fix.accuracy)}`);
  if (fix.timestamp) popupBits.push(formatDateTime(new Date(fix.timestamp)));
  popupBits.push('© OpenStreetMap');
  // The geo: link hands the coordinates to the phone's own maps app when tapped.
  marker.bindPopup(
    `<strong>${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}</strong><br />` +
      `${address ? `${address}<br />` : ''}${popupBits.join(' · ')}<br />` +
      `<a href="${geoUri(fix.latitude, fix.longitude)}">Отвори в приложението за карти</a>`,
  );

  if (Number.isFinite(fix.accuracy) && fix.accuracy > 0) {
    if (!circle) {
      circle = L.circle(latlng, {
        radius: fix.accuracy,
        color: '#1f6feb',
        weight: 1,
        fillColor: '#1f6feb',
        fillOpacity: 0.15,
      }).addTo(map);
    } else {
      circle.setLatLng(latlng).setRadius(fix.accuracy);
    }
  }

  map.setView(latlng, zoom);
}

export function invalidateSize() {
  map?.invalidateSize();
}

export function destroy() {
  if (!map) return;
  map.remove();
  map = null;
  marker = null;
  circle = null;
  currentContainer = null;
}
