/**
 * All DOM rendering lives here so main.js stays an orchestration file.
 */

import { clear, el, setAttr, setText, show } from '../utils/dom.js';
import {
  accuracyLevel,
  formatAccuracy,
  formatAltitude,
  formatBytes,
  formatDateTime,
  formatDuration,
} from '../utils/coords.js';
import { CAMERA_STATES, GPS_STATES } from '../state.js';

// Session storage key for collapsed day states
const COLLAPSED_DAYS_KEY = 'gallery-collapsed-days';

/** Get set of collapsed dateKeys from sessionStorage */
function getCollapsedDays() {
  try {
    const stored = sessionStorage.getItem(COLLAPSED_DAYS_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

/** Save collapsed dateKeys to sessionStorage */
function saveCollapsedDays(collapsed) {
  try {
    sessionStorage.setItem(COLLAPSED_DAYS_KEY, JSON.stringify(Array.from(collapsed)));
  } catch {
    /* ignore */
  }
}

/** Toggle collapsed state for a dateKey */
function toggleCollapsed(dateKey) {
  const collapsed = getCollapsedDays();
  if (collapsed.has(dateKey)) {
    collapsed.delete(dateKey);
  } else {
    collapsed.add(dateKey);
  }
  saveCollapsedDays(collapsed);
  return collapsed.has(dateKey);
}

export function createRefs(root = document) {
  const pick = (id) => root.getElementById(id);
  return {
    warnSecure: pick('warn-secure'),
    warnSupport: pick('warn-support'),
    statusCamera: pick('status-camera'),
    statusGps: pick('status-gps'),
    stage: pick('stage'),
    video: pick('video'),
    hudCoords: pick('hud-coords'),
    hudAccuracy: pick('hud-accuracy'),
    hudAccuracyDot: pick('hud-accuracy-dot'),
    hudAltitude: pick('hud-altitude'),
    hudFixage: pick('hud-fixage'),
    hudAddress: pick('hud-address'),
    btnShutter: pick('btn-shutter'),
    btnSwitch: pick('btn-switch'),
    btnTorch: pick('btn-torch'),
    zoomRange: pick('zoom-range'),
    chkWatermark: pick('chk-watermark'),
    start: pick('start'),
    btnStart: pick('btn-start'),
    btnNative: pick('btn-native'),
    startError: pick('start-error'),
    nativeInput: pick('native-input'),
    review: pick('review'),
    reviewPhoto: pick('review-photo'),
    reviewMeta: pick('review-meta'),
    map: pick('map'),
    reviewNote: pick('review-note'),
    btnDownload: pick('btn-download'),
    btnShare: pick('btn-share'),
    btnCopy: pick('btn-copy'),
    btnOsm: pick('btn-osm'),
    btnGoogle: pick('btn-google'),
    btnSave: pick('btn-save'),
    btnNew: pick('btn-new'),
    gallery: pick('gallery'),
    galleryGrid: pick('gallery-grid'),
    galleryEmpty: pick('gallery-empty'),
    galleryCount: pick('gallery-count'),
    btnGalleryClear: pick('btn-gallery-clear'),
    toast: pick('toast'),
    mapPreviewContainer: pick('map-preview'),
  };
}

const CAMERA_LABELS = {
  [CAMERA_STATES.OFF]: ['камера: изключена', ''],
  [CAMERA_STATES.STARTING]: ['камера: стартира…', 'warn'],
  [CAMERA_STATES.ON]: ['камера: активна', 'ok'],
  [CAMERA_STATES.ERROR]: ['камера: грешка', 'error'],
};

export function renderChips(refs, { camera, gps, fix, fixAge }) {
  const [cameraText, cameraState] = CAMERA_LABELS[camera] ?? CAMERA_LABELS.off;
  setText(refs.statusCamera, cameraText);
  setAttr(refs.statusCamera, 'data-state', cameraState);

  let gpsText = 'GPS: търсене…';
  let gpsState = 'warn';
  if (gps === GPS_STATES.FIX && fix) {
    gpsText = `GPS: fix ${formatAccuracy(fix.accuracy)}`;
    gpsState = accuracyLevel(fix.accuracy);
  } else if (gps === GPS_STATES.DENIED) {
    gpsText = 'GPS: отказан';
    gpsState = 'error';
  } else if (gps === GPS_STATES.UNAVAILABLE) {
    gpsText = 'GPS: недостъпен';
    gpsState = 'error';
  }
  if (gps === GPS_STATES.FIX && Number.isFinite(fixAge)) {
    gpsText += ` · ${Math.round(fixAge)} с`;
  }

  setText(refs.statusGps, gpsText);
  setAttr(refs.statusGps, 'data-state', gpsState);
}

export function renderHud(refs, fix, { address = null, ageSeconds = null } = {}) {
  if (!fix) {
    setText(refs.hudCoords, 'търсене на GPS…');
    setText(refs.hudAccuracy, 'точност: —');
    setText(refs.hudAltitude, 'надм. височина: —');
    setText(refs.hudFixage, 'fix: —');
    setAttr(refs.hudAccuracyDot, 'class', 'dot dot--unknown');
    show(refs.hudAddress, false);
    return;
  }

  setText(refs.hudCoords, `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}`);
  setText(refs.hudAccuracy, `точност: ${formatAccuracy(fix.accuracy)}`);
  setAttr(refs.hudAccuracyDot, 'class', `dot dot--${accuracyLevel(fix.accuracy)}`);
  setText(refs.hudAltitude, `надм. височина: ${formatAltitude(fix.altitude)}`);
  setText(
    refs.hudFixage,
    ageSeconds == null ? 'fix: сега' : `fix: преди ${formatDuration(ageSeconds)}`,
  );

  if (address) {
    setText(refs.hudAddress, address);
    show(refs.hudAddress, true);
  } else {
    show(refs.hudAddress, false);
  }
}

let toastTimer = null;

export function showToast(refs, message, { timeout = 2800 } = {}) {
  if (!refs.toast || !message) return;
  setText(refs.toast, message);
  show(refs.toast, true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show(refs.toast, false), timeout);
}

export function setStartError(refs, message) {
  if (!refs.startError) return;
  if (!message) {
    show(refs.startError, false);
    setText(refs.startError, '');
    return;
  }
  setText(refs.startError, message);
  show(refs.startError, true);
}

export function setBusy(button, busy, labelWhenBusy = 'Моля, изчакай…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = labelWhenBusy;
    button.disabled = true;
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
  }
}

export function setStageVisible(refs, visible) {
  show(refs.stage, visible);
  show(refs.start, !visible);
}

export function setReviewVisible(refs, visible) {
  show(refs.review, visible);
}

export function setGalleryVisible(refs, visible) {
  show(refs.gallery, visible);
}

/** rows: Array<[label, value] | [label, value, {tone?: string}]> */
export function renderMeta(refs, rows) {
  if (!refs.reviewMeta) return;
  clear(refs.reviewMeta);
  for (const [label, value, options = {}] of rows) {
    if (value == null || value === '') continue;
    const item = el('li', {}, el('span', { class: 'meta__k', text: label }));
    const valueNode = el('span', { class: 'meta__v', text: String(value) });
    if (options.tone) setAttr(valueNode, 'data-tone', options.tone);
    item.append(valueNode);
    refs.reviewMeta.append(item);
  }
}

export function renderReviewPhoto(refs, url) {
  if (refs.reviewPhoto) refs.reviewPhoto.src = url;
}

export function setReviewNote(refs, message) {
  setText(refs.reviewNote, message ?? '');
  show(refs.reviewNote, Boolean(message));
}

export function setVisible(node, visible) {
  if (!node) return;
  node.hidden = !visible;
}

/**
 * Renders the gallery with photos grouped by week and day.
 * @param {HTMLElement} refs.galleryGrid - Container element
 * @param {Array} weeks - Grouped data from storage.listPhotosGrouped()
 * @param {Function} onOpen - Callback when photo tile clicked
 * @param {Function} onDelete - Callback when delete button clicked
 */
export function renderGallery(refs, weeks, { onOpen, onDelete } = {}) {
  if (!refs.galleryGrid) return;
  clear(refs.galleryGrid);
  
  // Defensive: ensure weeks is an array
  if (!Array.isArray(weeks) || weeks.length === 0) {
    setText(refs.galleryCount, '0');
    show(refs.galleryEmpty, true);
    return;
  }
  
  // Total count across all weeks
  const totalCount = weeks.reduce((sum, week) => 
    sum + (week.days?.reduce((dSum, day) => dSum + (day.count ?? 0), 0) ?? 0), 0);
  setText(refs.galleryCount, String(totalCount));
  show(refs.galleryEmpty, totalCount === 0);

  const collapsedDays = getCollapsedDays();
  const todayKey = getTodayKey();

  for (const week of weeks) {
    // Defensive: skip invalid week entries
    if (!week || !Array.isArray(week.days)) continue;
    
    const weekEl = el('section', { class: 'gallery-week' },
      // Week header
      el('header', { class: 'gallery-week__header' },
        el('span', { class: 'gallery-week__label', text: week.weekLabel ?? 'Неизвестна седмица' }),
        el('span', { class: 'gallery-week__count', text: `${week.days.reduce((s, d) => s + (d.count ?? 0), 0)} снимки` })
      ),
      // Days container
      el('div', { class: 'gallery-week__days' },
        ...week.days.map(day => {
          // Defensive: skip invalid day entries
          if (!day || !Array.isArray(day.photos)) return null;
          
          const isCollapsed = collapsedDays.has(day.dateKey);
          const isToday = day.isToday;
          
          return el('article', { 
            class: `gallery-day${isCollapsed ? ' gallery-day--collapsed' : ''}${isToday ? ' gallery-day--today' : ''}`,
            'data-date': day.dateKey,
          },
            // Day header (clickable to toggle)
            el('header', { 
              class: 'gallery-day__header',
              onclick: (e) => {
                e.stopPropagation();
                const newCollapsed = toggleCollapsed(day.dateKey);
                const dayEl = e.currentTarget.closest('.gallery-day');
                dayEl.classList.toggle('gallery-day--collapsed', newCollapsed);
              }
            },
              el('div', { class: 'gallery-day__info' },
                el('span', { class: 'gallery-day__label', text: day.dayLabel ?? 'Неизвестен ден' }),
                isToday && el('span', { class: 'gallery-day__today-badge', text: 'Днес', 'aria-label': 'Днес' })
              ),
              el('span', { class: 'gallery-day__count', text: `${day.count ?? 0} снимки` }),
              el('span', { class: 'gallery-day__toggle', 'aria-hidden': 'true', text: isCollapsed ? '▼' : '▲' })
            ),
            // Day photos grid
            el('div', { class: 'gallery-day__grid' },
              ...day.photos.map(item => {
                // Defensive: skip invalid photo entries
                if (!item || !item.blob) return null;
                
                const subtitle = Number.isFinite(item.latitude)
                  ? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`
                  : 'без координати';
                
                const hasMap = Boolean(item.hasMap && item.mapThumbUrl);

                return el('li', { class: 'tile' + (hasMap ? ' tile--has-map' : '') },
                  el('button', {
                    class: 'tile__btn',
                    type: 'button',
                    title: 'Отвори',
                    onclick: () => onOpen?.(item),
                  },
                    // Photo thumbnail (left)
                    el('div', { class: 'tile__media tile__media--photo' },
                      el('img', {
                        class: 'tile__img',
                        src: item.thumbUrl ?? item.url ?? '',
                        alt: 'Запазена снимка',
                        loading: 'lazy',
                      })
                    ),
                    // Map thumbnail (right) - NEW
                    hasMap ? el('div', { class: 'tile__media tile__media--map' },
                      el('img', {
                        class: 'tile__img tile__img--map',
                        src: item.mapThumbUrl,
                        alt: 'Миникарта',
                        loading: 'lazy',
                      }),
                      el('span', { class: 'tile__map-badge', 'aria-hidden': 'true' }, '🗺️')
                    ) : null,
                  ),
                  el('span', { class: 'tile__meta', text: subtitle }),
                  el('span', {
                    class: 'tile__meta',
                    text: `${formatDateTime(new Date(item.createdAt))} · ${formatBytes(item.size ?? 0)}`,
                  }),
                  el('button', {
                    class: 'tile__del',
                    type: 'button',
                    title: 'Изтрий',
                    'aria-label': 'Изтрий снимката',
                    text: '✕',
                    onclick: (event) => {
                      event.stopPropagation();
                      onDelete?.(item);
                    },
                  }),
                );
              }).filter(Boolean) // Filter out any null entries from defensive checks
            )
          );
        }).filter(Boolean) // Filter out any null entries from defensive checks
      )
    );
    refs.galleryGrid.append(weekEl);
  }
}

/** Get today's date key for highlighting */
function getTodayKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export function setTorchAvailable(refs, available) {
  if (refs.btnTorch) refs.btnTorch.disabled = !available;
}

export function setZoomRange(refs, { min = 1, max = 1, step = 0.1, value = 1 } = {}) {
  if (!refs.zoomRange) return;
  refs.zoomRange.disabled = !(max > min);
  refs.zoomRange.min = String(min);
  refs.zoomRange.max = String(max);
  refs.zoomRange.step = String(step);
  refs.zoomRange.value = String(value);
}

/** Render map preview in review card */
export function renderMapPreview(refs, mapUrl, mapFilename, mapBlob) {
  const container = refs.mapPreviewContainer;
  if (!container) return;
  
  if (mapUrl && mapBlob) {
    container.innerHTML = '';
    container.append(
      el('img', { src: mapUrl, alt: 'Миникарта на мястото', class: 'review__map-preview' }),
      el('button', { 
        class: 'btn btn--ghost btn--sm', 
        onclick: () => {
          if (mapBlob && mapFilename) {
            import('../modules/share.js').then(share => share.downloadBlob(mapBlob, mapFilename));
          }
        } 
      }, 'Изтегли карта')
    );
    container.hidden = false;
  } else {
    container.hidden = true;
  }
}

/** Update download button to "Download Both" when map exists */
export function updateDownloadButton(refs, hasMap, onDownloadBoth, onDownloadSingle) {
  const btn = refs.btnDownload;
  if (!btn) return;
  
  if (hasMap) {
    btn.textContent = 'Изтегли и двете';
    btn.onclick = onDownloadBoth;
  } else {
    btn.textContent = 'Изтегли';
    btn.onclick = onDownloadSingle;
  }
}
