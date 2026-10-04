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
import {
  MAX_COMMENT_LENGTH,
  hasComment,
  truncateComment,
} from '../utils/comment.js';

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
    chkQr: pick('chk-qr'),
    commentInput: pick('comment-input'),
    commentCount: pick('comment-count'),
    start: pick('start'),
    btnStart: pick('btn-start'),
    btnNative: pick('btn-native'),
    startError: pick('start-error'),
    nativeInput: pick('native-input'),
    btnImport: pick('btn-import'),
    importInput: pick('import-input'),
    review: pick('review'),
    reviewPhoto: pick('review-photo'),
    reviewMeta: pick('review-meta'),
    reviewComment: pick('review-comment'),
    reviewCommentHint: pick('review-comment-hint'),
    map: pick('map'),
    reviewNote: pick('review-note'),
    btnToggleMeta: pick('btn-toggle-meta'),
    metaPanel: pick('meta-panel'),
    btnDownload: pick('btn-download'),
    btnDownloadMap: pick('btn-download-map'),
    btnNavigate: pick('btn-navigate'),
    btnCopyNav: pick('btn-copy-nav'),
    btnQr: pick('btn-qr'),
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
    qrPanel: pick('qr-panel'),
    drawToolbar: pick('draw-toolbar'),
    drawCanvas: pick('draw-canvas'),
    btnUndo: pick('btn-undo'),
    btnClearDraw: pick('btn-clear-draw'),
    drawWidthSelect: pick('draw-width'),
    drawColorBtns: root.querySelectorAll('.draw-color'),
    btnToggleDraw: pick('btn-toggle-draw'),
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

/** Initialize the metadata toggle button and panel */
export function initMetaToggle(refs) {
  if (!refs.btnToggleMeta || !refs.metaPanel) return;
  
  refs.btnToggleMeta.hidden = false;
  
  refs.btnToggleMeta.onclick = () => {
    toggleMetaPanel(refs);
  };
}

/** Toggle the metadata panel visibility */
export function toggleMetaPanel(refs) {
  if (!refs.btnToggleMeta || !refs.metaPanel) return;
  
  const isExpanded = !refs.metaPanel.hidden;
  const newExpanded = !isExpanded;
  
  refs.metaPanel.hidden = !newExpanded;
  refs.btnToggleMeta.setAttribute('aria-expanded', String(newExpanded));
  
  const textSpan = refs.btnToggleMeta.querySelector('.meta-toggle__text');
  const iconSpan = refs.btnToggleMeta.querySelector('.meta-toggle__icon');
  
  if (textSpan) {
    textSpan.textContent = newExpanded ? 'Скрий информацията' : 'Покажи информацията';
  }
  if (iconSpan) {
    iconSpan.textContent = newExpanded ? '▲' : '▼';
  }
}

/** Reset metadata panel to collapsed state */
export function resetMetaPanel(refs) {
  if (!refs.btnToggleMeta || !refs.metaPanel) return;
  
  refs.metaPanel.hidden = true;
  refs.btnToggleMeta.setAttribute('aria-expanded', 'false');
  refs.btnToggleMeta.hidden = true;
  
  const textSpan = refs.btnToggleMeta.querySelector('.meta-toggle__text');
  const iconSpan = refs.btnToggleMeta.querySelector('.meta-toggle__icon');
  
  if (textSpan) textSpan.textContent = 'Покажи информацията';
  if (iconSpan) iconSpan.textContent = '▼';
}

export function renderReviewPhoto(refs, url) {
  if (refs.reviewPhoto) refs.reviewPhoto.src = url;
}

/* --------------------------------------------------------------- comment field */

/**
 * Comment draft shown under the shutter.
 *
 * Called only on explicit events (never from the 1s render timer) and it writes to
 * the textarea only when the value really differs, so the caret never jumps while
 * the user is typing on a phone keyboard.
 */
export function renderStageComment(refs, comment) {
  const value = comment ?? '';
  if (refs.commentInput && refs.commentInput.value !== value) refs.commentInput.value = value;
  updateCommentCount(refs, value);
}

/** Live "123/500" counter next to the draft field. */
export function updateCommentCount(refs, value) {
  if (!refs.commentCount) return;
  const used = typeof value === 'string' ? value.length : 0;
  setText(refs.commentCount, `${used}/${MAX_COMMENT_LENGTH}`);
  setAttr(refs.commentCount, 'data-state', used >= MAX_COMMENT_LENGTH * 0.9 ? 'warn' : 'ok');
}

/**
 * Comment field of the review card.
 *
 * `saved` marks a record that already exists in the gallery: the primary button then
 * updates the stored comment instead of saving a second copy of the photo.
 */
export function renderReviewComment(refs, { comment = '', saved = false } = {}) {
  const value = comment ?? '';
  if (refs.reviewComment && refs.reviewComment.value !== value) refs.reviewComment.value = value;
  setText(
    refs.reviewCommentHint,
    saved
      ? 'Коментарът е записан в галерията — „Запази коментара“ го обновява.'
      : 'Коментарът ще се запази заедно със снимката и миникартата.',
  );
}

/** Swaps the primary button between "save as new" and "update the stored comment". */
export function renderSaveLabel(refs, { saved = false, hasDrawingChanges = false } = {}) {
  if (!refs.btnSave) return;
  if (saved) {
    refs.btnSave.textContent = hasDrawingChanges ? 'Запази промените' : 'Запази коментара';
  } else {
    refs.btnSave.textContent = 'Запази в галерията';
  }
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
                const hasText = hasComment(item.comment);
                const commentPreview = truncateComment(item.comment);

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
                      }),
                      hasText
                        ? el('span', { class: 'tile__comment-badge', 'aria-hidden': 'true' }, '💬')
                        : null
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
                  hasText ? el('span', { class: 'tile__comment', text: commentPreview, title: item.comment }) : null,
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

/** Render map preview in review card (the download buttons live in the actions row) */
export function renderMapPreview(refs, mapUrl, mapFilename, mapBlob) {
  const container = refs.mapPreviewContainer;
  if (!container) return;
  
  if (mapUrl && mapBlob) {
    clear(container);
    container.append(
      el('img', { src: mapUrl, alt: 'Миникарта на мястото', class: 'review__map-preview' })
    );
    container.hidden = false;
  } else {
    clear(container);
    container.hidden = true;
  }
}

/**
 * Shows/hides the two download buttons.
 * The photo button is always visible; the map button is shown when a map blob
 * exists OR when the photo has a GPS fix (the map can then be captured on demand).
 */
export function updateDownloadButtons(refs, { hasMap = false, hasFix = false } = {}) {
  if (refs.btnDownload) {
    refs.btnDownload.textContent = 'Изтегли снимка';
  }
  if (refs.btnDownloadMap) {
    setVisible(refs.btnDownloadMap, hasMap || hasFix);
    refs.btnDownloadMap.textContent = 'Изтегли карта';
  }
}

/* ---------------------------------------------------------------- navigation */

/**
 * The three location actions only make sense when the photo has a GPS fix:
 * Навигирай (deep link to the maps app), Копирай за навигация and Покажи QR.
 */
export function updateNavigationButtons(refs, { hasFix = false } = {}) {
  setVisible(refs.btnNavigate, hasFix);
  setVisible(refs.btnCopyNav, hasFix);
  setVisible(refs.btnQr, hasFix);
}

/**
 * QR panel of the review card: the code, the link it encodes and a short hint.
 * Passing no canvas hides the panel again.
 */
export function renderQrPanel(refs, canvas, text = '') {
  const container = refs.qrPanel;
  if (!container) return;

  clear(container);
  if (!canvas) {
    container.hidden = true;
    return;
  }

  container.append(
    canvas,
    el('p', { class: 'qr__text', text }),
    el('p', {
      class: 'qr__hint',
      text: 'Сканирай кода с друг телефон (или с Google Lens) — отваря Google Maps.',
    }),
  );
  container.hidden = false;
}

/* ---------------------------------------------------------------- drawing */

/**
 * Shows the drawing toolbar and sets up color/width selection.
 * @param {object} refs
 * @param {object} drawing - Drawing controller from drawing.js
 */
export function showDrawToolbar(refs, drawing) {
  if (!refs.drawToolbar) return;
  refs.drawToolbar.hidden = false;

  // Set active color
  const currentColor = drawing.currentColor();
  refs.drawColorBtns?.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === currentColor);
  });

  // Set width select
  if (refs.drawWidthSelect) {
    refs.drawWidthSelect.value = String(drawing.currentWidth());
  }
}

/**
 * Hides the drawing toolbar.
 * @param {object} refs
 */
export function hideDrawToolbar(refs) {
  if (!refs.drawToolbar) return;
  refs.drawToolbar.hidden = true;
}

/**
 * Updates the active color button visual state.
 * @param {object} refs
 * @param {string} color
 */
export function setActiveDrawColor(refs, color) {
  refs.drawColorBtns?.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}

/**
 * Resizes the drawing canvas to match the displayed image size.
 * @param {object} refs
 * @param {number} displayWidth
 * @param {number} displayHeight
 */
export function resizeDrawCanvas(refs, displayWidth, displayHeight) {
  if (!refs.drawCanvas) return;
  refs.drawCanvas.style.width = `${displayWidth}px`;
  refs.drawCanvas.style.height = `${displayHeight}px`;
  // The drawing controller will handle internal canvas sizing via setDisplaySize
}

/** Initialize the drawing toggle button - makes it visible */
export function initDrawToggle(refs) {
  if (!refs.btnToggleDraw || !refs.drawToolbar) return;
  
  refs.btnToggleDraw.hidden = false;
  // Note: onclick handler is set by main.js via setupDrawToggleButton()
}

/** Reset drawing mode to disabled */
export function resetDrawMode(refs) {
  if (!refs.btnToggleDraw || !refs.drawToolbar || !refs.drawCanvas) return;
  
  refs.btnToggleDraw.setAttribute('aria-pressed', 'false');
  refs.btnToggleDraw.hidden = true;
  refs.drawToolbar.hidden = true;
  refs.drawCanvas.style.pointerEvents = 'none';
  
  const textSpan = refs.btnToggleDraw.querySelector('.draw-toggle__text');
  if (textSpan) textSpan.textContent = 'Рисувай';
}
