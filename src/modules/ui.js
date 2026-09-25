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

export function renderGallery(refs, items, { onOpen, onDelete } = {}) {
  if (!refs.galleryGrid) return;
  clear(refs.galleryGrid);
  setText(refs.galleryCount, String(items.length));
  show(refs.galleryEmpty, items.length === 0);

  for (const item of items) {
    const subtitle = Number.isFinite(item.latitude)
      ? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`
      : 'без координати';

    refs.galleryGrid.append(
      el(
        'li',
        { class: 'tile' },
        el(
          'button',
          {
            class: 'tile__btn',
            type: 'button',
            title: 'Отвори',
            onclick: () => onOpen?.(item),
          },
          el('img', {
            class: 'tile__img',
            src: item.thumbUrl ?? item.url ?? '',
            alt: 'Запазена снимка',
            loading: 'lazy',
          }),
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
      ),
    );
  }
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
