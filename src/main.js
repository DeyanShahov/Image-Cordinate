/**
 * Image Coordinate - entry point and orchestration.
 *
 * Flow: request camera + GPS -> live preview with a coordinate HUD -> freeze the
 * fix when the shutter is pressed -> capture (ImageCapture or canvas) -> write
 * EXIF GPS + optional watermark -> review card with map, download and share.
 */

import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

import { CAMERA_STATES, GPS_STATES, PHASES, getState, setState, subscribe } from './state.js';
import { show } from './utils/dom.js';
import {
  formatAccuracy,
  formatAltitude,
  formatBytes,
  formatDateTime,
  formatDms,
  googleMapsUrl,
  makePhotoFilename,
  navigationLinks,
  navigationText,
  osmUrl,
  plainCoordinates,
} from './utils/coords.js';
import { encodeOlc } from './utils/olc.js';
import { describeGeolocationError, describeMediaError, describeShareError } from './utils/errors.js';
import { hasComment, normalizeComment, withCommentSummary } from './utils/comment.js';
import { createThumbnail } from './utils/image.js';
import * as camera from './modules/camera.js';
import * as exif from './modules/exif.js';
import { reverseGeocode, clearMemoryCache } from './modules/geocode.js';
import * as geo from './modules/geolocation.js';
import * as inbox from './modules/inbox.js';
import * as mapModule from './modules/map.js';
import * as mapCapture from './modules/map-capture.js';
import { pickPhotoFile, readDeviceMetadata } from './modules/native-capture.js';
import * as qr from './modules/qr.js';
import * as share from './modules/share.js';
import * as storage from './modules/storage.js';
import * as ui from './modules/ui.js';
import * as wakelock from './modules/wakelock.js';
import * as watermark from './modules/watermark.js';
import * as drawing from './modules/drawing.js';

const refs = ui.createRefs();

let watchId = null;
let currentFacing = 'environment';
let hudTimer = null;
let geocodeTimer = null;
let lastGeocodeKey = null;
/** Object URL of the photo currently shown in the review card. */
let reviewUrl = null;
/** Object URL of the map currently shown in the review card. */
let reviewMapUrl = null;
/** Object URLs handed to the gallery grid (revoked on every refresh). */
const galleryUrls = new Map();

/* ------------------------------------------------------------------ guards */

function guardEnvironment() {
  show(refs.warnSecure, globalThis.isSecureContext !== true);

  const warnings = [];
  if (!camera.isSupported()) {
    warnings.push(
      'Този браузър не дава достъп до камерата (MediaDevices) — използвай „Снимай с нативната камера“.',
    );
  }
  if (!camera.isImageCaptureSupported()) {
    warnings.push('ImageCapture липсва (типично за iOS) — кадърът се взема от видеото.');
  }
  if (!geo.isSupported()) warnings.push('Geolocation API не се поддържа от браузъра.');
  if (!exif.isSupported()) {
    warnings.push('EXIF библиотеката не се зареди — координатите няма да влязат в EXIF.');
  }
  if (!storage.isAvailable()) warnings.push('IndexedDB е недостъпен — галерията няма да работи.');

  if (warnings.length && refs.warnSupport) {
    refs.warnSupport.textContent = warnings.join(' ');
    show(refs.warnSupport, true);
  }
}

/* -------------------------------------------------------------- geolocation */

function startGps({ quiet = false } = {}) {
  if (watchId != null || !geo.isSupported()) return;
  setState({ gps: GPS_STATES.SEARCHING });
  watchId = geo.startWatch({
    onFix: (fix) => {
      setState({ fix, gps: GPS_STATES.FIX });
      scheduleGeocode(fix);
    },
    onError: (error) => {
      const denied = error?.code === 1;
      setState({ gps: denied ? GPS_STATES.DENIED : GPS_STATES.UNAVAILABLE });
      if (quiet) return;
      const message = describeGeolocationError(error);
      ui.setStartError(refs, message);
      ui.showToast(refs, message, { timeout: 5000 });
    },
  });
}

function stopGps() {
  geo.stopWatch(watchId);
  watchId = null;
}

function scheduleGeocode(fix) {
  const key = `${fix.latitude.toFixed(4)},${fix.longitude.toFixed(4)}`;
  if (key === lastGeocodeKey) return;
  lastGeocodeKey = key;
  clearTimeout(geocodeTimer);
  geocodeTimer = setTimeout(async () => {
    const result = await reverseGeocode(fix.latitude, fix.longitude);
    if (result) setState({ address: result.label ?? result.displayName ?? null });
  }, 1500);
}

/* ------------------------------------------------------------------ camera */

async function startCameraFlow() {
  ui.setStartError(refs, null);
  setState({ camera: CAMERA_STATES.STARTING, phase: PHASES.STARTING });
  ui.setBusy(refs.btnStart, true, 'Стартиране…');

  try {
    const stream = await camera.startStream({ facingMode: currentFacing });
    await camera.attachStream(stream, refs.video);
    setState({ camera: CAMERA_STATES.ON, phase: PHASES.LIVE, error: null });
    ui.setStageVisible(refs, true);
    ui.setReviewVisible(refs, false);
    applyTrackCapabilities();
    void wakelock.acquireWakeLock();
    void refreshCameraList();
  } catch (error) {
    const message = describeMediaError(error);
    setState({ camera: CAMERA_STATES.ERROR, phase: PHASES.ERROR, error: message });
    ui.setStartError(refs, message);
  } finally {
    ui.setBusy(refs.btnStart, false);
    startGps();
    renderAll();
  }
}

function applyTrackCapabilities() {
  const track = camera.getVideoTrack();
  const capabilities = camera.getCapabilities(track);
  ui.setTorchAvailable(refs, Boolean(capabilities.torch));

  if (capabilities.zoom && capabilities.zoom.max > capabilities.zoom.min) {
    ui.setZoomRange(refs, {
      min: capabilities.zoom.min,
      max: capabilities.zoom.max,
      step: capabilities.zoom.step || 0.1,
      value: track?.getSettings?.().zoom ?? capabilities.zoom.min,
    });
  } else {
    ui.setZoomRange(refs, { min: 1, max: 1 });
  }
}

async function refreshCameraList() {
  try {
    const devices = await camera.listVideoInputs();
    setState({ cameras: devices.map((device) => ({ id: device.deviceId, label: device.label })) });
  } catch {
    /* device labels need camera permission - safe to ignore */
  }
}

async function toggleCamera() {
  const next = currentFacing === 'environment' ? 'user' : 'environment';
  try {
    const stream = await camera.startStream({ facingMode: next });
    await camera.attachStream(stream, refs.video);
    currentFacing = next;
    applyTrackCapabilities();
  } catch (error) {
    ui.showToast(refs, describeMediaError(error));
  }
}

/* ------------------------------------------------------------------- render */

function renderAll() {
  const state = getState();
  const age = geo.fixAgeSeconds(state.fix);

  ui.renderChips(refs, {
    camera: state.camera,
    gps: state.gps,
    fix: state.fix,
    fixAge: age,
  });
  ui.renderHud(refs, state.fix, { address: state.address, ageSeconds: age });

  if (refs.btnShutter) {
    refs.btnShutter.disabled = Boolean(state.busy) || state.camera !== CAMERA_STATES.ON;
    refs.btnShutter.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  }
}

/* ----------------------------------------------------------------- capture */

async function captureFromCamera() {
  const state = getState();
  if (state.busy || state.camera !== CAMERA_STATES.ON) return;

  setState({ busy: true, phase: PHASES.CAPTURING });
  ui.showToast(refs, 'Заснемане…', { timeout: 1200 });

  // The fix and the comment draft are frozen at the exact moment the shutter was
  // pressed, so every photo carries the text that was on screen when it was taken.
  const fix = state.fix ? { ...state.fix } : null;
  const comment = normalizeComment(state.comment);
  const capturedAt = new Date();

  try {
    const track = camera.getVideoTrack();
    const frame = await camera.captureFrame(track, refs.video);
    const result = await processPhoto({
      blob: frame.blob,
      fix,
      comment,
      capturedAt,
      source: frame.source,
      pixelSize:
        frame.width && frame.height ? { width: frame.width, height: frame.height } : null,
    });
    showResult(result);
  } catch (error) {
    ui.showToast(refs, error instanceof Error ? error.message : 'Заснемането не успя.');
  } finally {
    setState({ busy: false, phase: PHASES.LIVE });
    renderAll();
    void wakelock.acquireWakeLock();
  }
}

async function captureFromNativeCamera() {
  const file = await pickPhotoFile(refs.nativeInput);
  if (!file) return;

  setState({ busy: true, phase: PHASES.CAPTURING });
  ui.showToast(refs, 'Обработка на снимката…', { timeout: 1500 });

  try {
    const device = await readDeviceMetadata(file);
    const fix = mergeFixes(device.gps, getState().fix);
    const comment = normalizeComment(getState().comment);
    const capturedAt = device.takenAt ?? new Date();
    const result = await processPhoto({
      blob: file,
      fix,
      comment,
      capturedAt,
      source: 'native',
      pixelSize:
        device.width && device.height ? { width: device.width, height: device.height } : null,
      device,
    });
    showResult(result, { device });
  } catch (error) {
    ui.showToast(refs, error instanceof Error ? error.message : 'Файлът не можа да се обработи.');
  } finally {
    setState({ busy: false, phase: PHASES.REVIEW });
    renderAll();
  }
}

/**
 * "Зареди снимка": opens a photo that already exists on the device (received by chat,
 * mail, ...) and reads its GPS out of the EXIF, so it can be navigated to.
 *
 * The file is never re-encoded here - the pixels and the original metadata stay exactly
 * as they came in, which is why the result is assembled directly instead of going
 * through `processPhoto`.
 */
async function importPhoto(file) {
  if (!file) return;
  if (!file.type?.startsWith('image/')) {
    ui.showToast(refs, 'Файлът не е изображение.');
    return;
  }

  ui.setBusy(refs.btnImport, true, 'Зареждане…');
  try {
    const device = await readDeviceMetadata(file);
    if (!device.gps) {
      ui.showToast(
        refs,
        'Снимката няма GPS в EXIF — вероятно метаданните са премахнати при препращане (изпращай снимката като файл/документ).',
        { timeout: 9000 },
      );
      return;
    }

    const fix = { ...device.gps, source: 'device' };
    const capturedAt = device.takenAt ?? new Date(file.lastModified || Date.now());
    const geocoded = await reverseGeocode(fix.latitude, fix.longitude);
    const address = geocoded?.label ?? geocoded?.displayName ?? null;
    const extension = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');

    showResult(
      {
        blob: file,
        fix,
        address,
        capturedAt,
        source: 'import',
        watermarked: false,
        qrBurned: false,
        device,
        comment: normalizeComment(getState().comment),
        exifComment: '',
        recordId: null,
        exif: {
          applied: false,
          gpsWritten: true,
          commentWritten: false,
          reason: 'снимката е заредена както е (EXIF не се пренаписва)',
        },
        verification: {
          verified: true,
          gps: { latitude: fix.latitude, longitude: fix.longitude },
          distance: null,
          reason: 'координати, прочетени от EXIF на снимката',
        },
        commentVerified: null,
        size: file.size,
        filename: makePhotoFilename(capturedAt, fix.latitude, fix.longitude, extension),
      },
      { device, address },
    );

    ui.showToast(refs, 'Координатите са прочетени от снимката — „Навигирай“ е готово.', {
      timeout: 6000,
    });
  } catch (error) {
    ui.showToast(refs, error instanceof Error ? error.message : 'Снимката не можа да се зареди.');
  } finally {
    ui.setBusy(refs.btnImport, false);
  }
}

/** Opens the file picker for the import flow (the input has no `capture`, see index.html). */
async function pickImportFile() {
  const file = await pickPhotoFile(refs.importInput);
  if (file) await importPhoto(file);
}

/**
 * Android "Сподели → Image Coordinate": the service worker parks the shared photo in
 * the inbox and redirects here, so all we have to do is run the import flow.
 *
 * @returns {Promise<void>}
 */
async function pickUpSharedPhoto() {
  const shared = await inbox.takeSharedPhoto();
  const sharedParam = new URLSearchParams(location.search).has('shared');

  if (shared) {
    try {
      const file = new File([shared.blob], shared.name || 'shared-photo', {
        type: shared.blob.type || shared.type || 'image/jpeg',
      });
      ui.showToast(refs, 'Зареждане на споделената снимка…', { timeout: 2000 });
      await importPhoto(file);
    } catch (error) {
      console.warn('shared photo import failed', error);
    }
  } else if (sharedParam) {
    ui.showToast(refs, 'Споделената снимка не беше получена (твърде голяма?).', { timeout: 7000 });
  }

  // Drop the ?shared=1 marker so a refresh does not look like a new share.
  if (sharedParam) history.replaceState(null, '', location.pathname);
}

/**
 * Device EXIF vs live fix: when they disagree by more than the combined accuracy
 * we trust the browser fix, because there we know the reported accuracy.
 */
function mergeFixes(deviceGps, liveFix) {
  if (!deviceGps) return liveFix;
  if (!liveFix) return { ...deviceGps, timestamp: Date.now() };
  const distance = geo.distanceMeters(deviceGps, liveFix);
  const combined = (deviceGps.accuracy ?? 30) + (liveFix.accuracy ?? 30);
  return distance > Math.max(30, combined) ? liveFix : { ...deviceGps, source: 'device' };
}

/** Watermark (optional) + EXIF GPS + read-back verification. */
async function processPhoto({ blob, fix, capturedAt, source, pixelSize, device = null, comment = '' }) {
  const state = getState();
  let photo = blob;
  let watermarked = false;
  let qrBurned = false;
  let targetSize = pixelSize;

  const hasFix = Boolean(fix && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude));
  const wantsQr = Boolean(state.qr) && hasFix;

  // The QR code lives in the pixels, so asking for one means the photo has to be
  // re-encoded - exactly like the watermark (which is therefore switched on too).
  if (state.watermark || wantsQr) {
    let qrMatrix = null;

    if (wantsQr) {
      qrMatrix = await qr.createQrMatrix(qr.qrPayloadFor(fix.latitude, fix.longitude));
      if (!qrMatrix) {
        ui.showToast(
          refs,
          'QR кодът не е наличен — инсталирай пакета qrcode-generator (npm install).',
          { timeout: 7000 },
        );
      }
    }

    try {
      const stamped = await watermark.withWatermark(photo, {
        fix,
        address: state.address,
        capturedAt,
        qrMatrix,
      });
      photo = stamped.blob;
      watermarked = true;
      qrBurned = Boolean(qrMatrix);
      targetSize = { width: stamped.width, height: stamped.height };
    } catch (error) {
      ui.showToast(refs, `Водният знак не беше приложен: ${error.message}`);
    }
  }

  const exifResult = await exif.writeGeoExif(photo, {
    fix,
    address: state.address,
    capturedAt,
    source,
    // XPComment (UTF-16LE): the comment travels inside the JPEG as well.
    comment,
    pixelSize: targetSize,
    // Re-encoding through canvas normalises the orientation, so reset the tag.
    resetOrientation: watermarked,
  });

  const verification =
    exifResult.applied && exifResult.gpsWritten
      ? await exif.verifyGps(exifResult.blob, fix, 5)
      : {
          verified: false,
          gps: null,
          distance: null,
          reason: exifResult.reason ?? 'няма GPS тагове',
        };

  // The comment gets the same treatment as the coordinates: read it back out of the
  // file we just wrote, so the review card can show "записан и проверен".
  const commentVerified =
    hasComment(comment) && exifResult.applied && exifResult.commentWritten
      ? (await exif.readCommentFromBlob(exifResult.blob)) === normalizeComment(comment)
      : false;

  return {
    blob: exifResult.blob,
    fix,
    capturedAt,
    source,
    watermarked,
    /** Whether the Google Maps QR code was drawn into the pixels. */
    qrBurned,
    device,
    /**
     * Comment frozen with the shutter (see state.comment). It stays on the result so
     * the review card can edit it before saving and so a gallery record can carry it.
     */
    comment,
    /** The text that went into the JPEG (XPComment) - used to detect later edits. */
    exifComment: normalizeComment(comment),
    /** Set when the record already exists in the gallery (opened from there). */
    recordId: null,
    exif: exifResult,
    verification,
    /** Comment read back out of the JPEG (null for photos opened from the gallery). */
    commentVerified,
    size: exifResult.blob.size,
    filename: makePhotoFilename(capturedAt, fix?.latitude, fix?.longitude),
  };
}

/* ------------------------------------------------------------------ review */

const SOURCE_LABELS = {
  'image-capture': 'браузър (ImageCapture — пълен кадър)',
  canvas: 'браузър (кадър от видео — iOS)',
  native: 'нативна камера на телефона',
  device: 'EXIF на устройството',
  import: 'заредена снимка (координати от EXIF)',
};

function describeExif(result) {
  const { exif: exifResult, verification } = result;
  // A photo that was loaded from the device keeps its own EXIF untouched.
  if (result.source === 'import' && !exifResult.applied) return 'прочетен от снимката (не е пренаписван)';
  if (!exifResult.applied) return `не е записан (${exifResult.reason})`;
  if (!exifResult.gpsWritten) return 'обновен, но без GPS тагове';
  if (!verification.verified) return `записан, без потвърждение (${verification.reason})`;
  return `записан и проверен (Δ ${(verification.distance ?? 0).toFixed(2)} m)`;
}

/** Human readable state of the comment inside the JPEG. */
function describeComment(result) {
  if (!hasComment(result.comment)) return null;
  if (!result.exif?.applied) return `не е записан (${result.exif?.reason ?? 'EXIF недостъпен'})`;
  if (!result.exif.commentWritten) return 'не е записан';
  if (result.commentVerified === true) return 'записан и проверен';
  if (result.commentVerified === false) return 'записан, без потвърждение';
  return 'записан';
}

/** Whether the Google Maps QR code made it into the pixels of this photo. */
function describeQr(result) {
  if (result.qrBurned) return 'в снимката — сканирай за Google Maps';
  // A loaded photo is never re-encoded, so the QR question does not apply to it.
  if (result.source === 'import') return null;
  return getState().qr ? 'не е приложен' : null;
}

function buildMetaRows(result, device, address) {
  const { fix, capturedAt } = result;
  return [
    [
      'Координати (DD)',
      fix ? `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}` : 'без GPS fix',
    ],
    ['Координати (DMS)', fix ? formatDms(fix.latitude, fix.longitude) : null],
    ['Plus Code', fix ? encodeOlc(fix.latitude, fix.longitude) : null],
    ['Точност', fix && Number.isFinite(fix.accuracy) ? formatAccuracy(fix.accuracy) : null],
    ['Надм. височина', fix && Number.isFinite(fix.altitude) ? formatAltitude(fix.altitude) : null],
    ['Адрес', address],
    ['Заснета', formatDateTime(capturedAt)],
    ['Източник', SOURCE_LABELS[result.source] ?? result.source],
    ['Камера (устройство)', device ? [device.make, device.model].filter(Boolean).join(' ') : null],
    ['EXIF GPS', describeExif(result)],
    ['Коментар в EXIF', describeComment(result)],
    ['QR код', describeQr(result)],
    ['Воден знак', result.watermarked ? 'да' : 'не'],
    ['Размер на файла', formatBytes(result.size)],
  ];
}

/**
 * Initializes the drawing overlay for the review photo.
 * @param {object} result - The photo result object with blob, fix, etc.
 */
let drawingController = null;

function initDrawingForReview(result) {
  // Clean up previous drawing controller if any
  if (drawingController && drawingController._cleanup) {
    drawingController._cleanup();
  }
  drawingController = null;

  // Get the displayed image dimensions
  const img = refs.reviewPhoto;
  if (!img || !img.naturalWidth) {
    // Image not loaded yet, wait for it
    img?.addEventListener('load', () => initDrawingForReview(result), { once: true });
    return;
  }

  const displayWidth = img.clientWidth;
  const displayHeight = img.clientHeight;
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;

  // Create drawing controller
  drawingController = drawing.createDrawingController(
    refs.drawCanvas,
    naturalWidth,
    naturalHeight
  );

  // Set display size for rendering
  drawingController.setDisplaySize(displayWidth, displayHeight);

  // Resize canvas overlay to match displayed image
  ui.resizeDrawCanvas(refs, displayWidth, displayHeight);

  // Enable pointer events on canvas for drawing
  refs.drawCanvas.style.pointerEvents = 'auto';

  // Show toolbar
  ui.showDrawToolbar(refs, drawingController);

  // --- Event handlers ---

  // Color selection
  refs.drawColorBtns?.forEach(btn => {
    btn.onclick = () => {
      const color = btn.dataset.color;
      drawingController.setColor(color);
      ui.setActiveDrawColor(refs, color);
    };
  });

  // Width selection
  if (refs.drawWidthSelect) {
    refs.drawWidthSelect.onchange = (e) => {
      drawingController.setWidth(Number(e.target.value));
    };
  }

  // Undo
  if (refs.btnUndo) {
    refs.btnUndo.onclick = () => {
      drawingController.undo();
    };
  }

  // Clear
  if (refs.btnClearDraw) {
    refs.btnClearDraw.onclick = () => {
      drawingController.clear();
    };
  }

  // Done - hide toolbar, disable drawing
  if (refs.btnDoneDraw) {
    refs.btnDoneDraw.onclick = () => {
      refs.drawCanvas.style.pointerEvents = 'none';
      ui.hideDrawToolbar(refs);
      updateSaveButtonLabel();
    };
  }

  // Drawing events on canvas
  let isDrawing = false;

  const getClientCoords = (e) => {
    const rect = refs.drawCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { clientX, clientY, rect };
  };

  refs.drawCanvas.onpointerdown = (e) => {
    if (e.button !== 0) return; // only left click / touch
    isDrawing = true;
    const { clientX, clientY } = getClientCoords(e);
    drawingController.startStroke(clientX, clientY);
    refs.drawCanvas.setPointerCapture(e.pointerId);
  };

  refs.drawCanvas.onpointermove = (e) => {
    if (!isDrawing) return;
    const { clientX, clientY } = getClientCoords(e);
    drawingController.continueStroke(clientX, clientY);
  };

  refs.drawCanvas.onpointerup = (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    drawingController.endStroke();
    refs.drawCanvas.releasePointerCapture(e.pointerId);
  };

  refs.drawCanvas.onpointercancel = (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    drawingController.cancelStroke();
    refs.drawCanvas.releasePointerCapture(e.pointerId);
  };

  refs.drawCanvas.onpointerleave = (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    drawingController.endStroke();
  };

  // Keyboard shortcut: Ctrl+Z for undo
  const keydownHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      drawingController.undo();
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // Helper to update save button label based on drawing state
  const updateSaveButtonLabel = () => {
    const hasDrawing = drawingController && drawingController.hasStrokes();
    const saved = Boolean(getState().result?.recordId);
    ui.renderSaveLabel(refs, { saved, hasDrawingChanges: hasDrawing });
  };

  // Update button label after stroke changes
  const originalEndStroke = drawingController.endStroke.bind(drawingController);
  drawingController.endStroke = () => {
    originalEndStroke();
    updateSaveButtonLabel();
  };

  const originalUndo = drawingController.undo.bind(drawingController);
  drawingController.undo = () => {
    const result = originalUndo();
    updateSaveButtonLabel();
    return result;
  };

  const originalClear = drawingController.clear.bind(drawingController);
  drawingController.clear = () => {
    const result = originalClear();
    updateSaveButtonLabel();
    return result;
  };

  // Initial label update
  updateSaveButtonLabel();

  // Store cleanup handler on controller for later removal
  drawingController._cleanup = () => {
    document.removeEventListener('keydown', keydownHandler);
    refs.drawCanvas.onpointerdown = null;
    refs.drawCanvas.onpointermove = null;
    refs.drawCanvas.onpointerup = null;
    refs.drawCanvas.onpointercancel = null;
    refs.drawCanvas.onpointerleave = null;
    refs.drawCanvas.style.pointerEvents = 'none';
    ui.hideDrawToolbar(refs);
  };
}

function showResult(result, { device = null, address = getState().address } = {}) {
  if (reviewUrl) URL.revokeObjectURL(reviewUrl);
  reviewUrl = URL.createObjectURL(result.blob);
  ui.renderReviewPhoto(refs, reviewUrl);
  ui.renderMeta(refs, buildMetaRows(result, device, address));
  ui.renderReviewComment(refs, {
    comment: result.comment ?? '',
    saved: Boolean(result.recordId),
  });
  ui.renderSaveLabel(refs, { saved: Boolean(result.recordId), hasDrawingChanges: false });
  ui.setReviewVisible(refs, true);

  // Navigation actions: only meaningful when the photo has a fix at all.
  const hasFix = Boolean(result.fix && Number.isFinite(result.fix.latitude));
  ui.updateNavigationButtons(refs, { hasFix });
  // A new photo always starts with the QR panel closed.
  ui.renderQrPanel(refs, null);

  const asFile = new File([result.blob], result.filename, {
    type: result.blob.type || 'image/jpeg',
  });
  ui.setVisible(refs.btnShare, share.canShareFiles(asFile));

  if (result.fix) {
    show(refs.map, true);
    mapModule.ensureMap(refs.map);
    mapModule.showFix(result.fix, { address });
    requestAnimationFrame(() => mapModule.invalidateSize());
  } else {
    show(refs.map, false);
  }

  // NEW: Handle map preview in review card
  if (reviewMapUrl) URL.revokeObjectURL(reviewMapUrl);
  if (result.hasMap && result.mapBlob) {
    reviewMapUrl = URL.createObjectURL(result.mapBlob);
    ui.renderMapPreview(refs, reviewMapUrl, result.mapFilename, result.mapBlob);
  } else {
    ui.renderMapPreview(refs, null, null, null);
  }

  const notes = [];
  if (!result.fix) notes.push('Няма GPS fix — файлът е записан без координати.');
  if (!result.exif.applied) notes.push(`EXIF: ${result.exif.reason}`);
  else if (!result.exif.gpsWritten) notes.push('EXIF е обновен, но без GPS тагове.');
  else if (!result.verification.verified) {
    notes.push(`Проверката на EXIF не съвпадна: ${result.verification.reason}`);
  }
  ui.setReviewNote(refs, notes.join(' '));

  // Update state FIRST so the download handlers read the correct result.
  // The resolved address travels with the result: the navigation text then describes
  // this photo instead of the live GPS position (matters for loaded photos).
  setState({ result: { ...result, address }, phase: PHASES.REVIEW });

  // Show/hide the two download buttons (photo always; map when a blob exists or a fix allows on-demand capture)
  ui.updateDownloadButtons(refs, {
    hasMap: Boolean(result.hasMap && result.mapBlob),
    hasFix,
  });

  refs.review?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Initialize drawing overlay for the review photo
  initDrawingForReview(result);
}

function clearResult() {
  // Clean up drawing controller
  if (drawingController && drawingController._cleanup) {
    drawingController._cleanup();
    drawingController = null;
  }

  if (reviewUrl) {
    URL.revokeObjectURL(reviewUrl);
    reviewUrl = null;
  }
  if (reviewMapUrl) {
    URL.revokeObjectURL(reviewMapUrl);
    reviewMapUrl = null;
  }
  ui.setReviewVisible(refs, false);
  ui.renderMeta(refs, []);
  ui.setReviewNote(refs, null);
  ui.renderMapPreview(refs, null, null, null);
  ui.renderSaveLabel(refs, { saved: false, hasDrawingChanges: false });
  setState({ result: null, phase: PHASES.LIVE });
}

/* ----------------------------------------------------------------- actions */

function currentFile() {
  const result = getState().result;
  if (!result) return null;
  return new File([result.blob], result.filename, { type: result.blob.type || 'image/jpeg' });
}

/**
 * Text that is worth sharing: coordinates on the first line (Google Maps and the chat
 * apps pick those up), then a directions link, the Plus Code, the address and finally
 * the comment. This is what makes a forwarded photo or message navigable.
 */
function summaryText(result) {
  if (!result?.fix) return withCommentSummary('Снимка без GPS координати', result?.comment);
  const { latitude, longitude } = result.fix;
  return navigationText({
    latitude,
    longitude,
    address: result.address ?? getState().address,
    comment: result.comment,
    plusCode: encodeOlc(latitude, longitude),
  });
}

async function downloadPhoto() {
  const result = getState().result;
  if (!result || !result.blob) return;

  // If there are drawing strokes, bake them into the image before download
  let blobToDownload = result.blob;
  if (drawingController && drawingController.hasStrokes()) {
    ui.showToast(refs, 'Прилагане на анотации…', { timeout: 3000 });
    try {
      blobToDownload = await drawingController.bake(result.blob);
    } catch (e) {
      console.error('Drawing bake failed:', e);
      ui.showToast(refs, 'Неуспешно прилагане на анотациите.');
    }
  }

  share.downloadBlob(blobToDownload, result.filename);
  ui.showToast(refs, `Изтеглена снимка: ${result.filename}`, { timeout: 4000 });
}

/**
 * Downloads ONLY the mini-map image to the device.
 *
 * Freshly captured photos have no map yet (it is normally created when saving to
 * the gallery), so when there is a GPS fix we rasterise the on-screen map right
 * now and keep it on the result for a later "Запази в галерията".
 */
async function downloadMap() {
  const result = getState().result;
  if (!result) return;

  let { mapBlob, mapFilename } = result;

  // No map yet, but we know where the photo was taken - build it on demand.
  if ((!mapBlob || !mapFilename) && result.fix && Number.isFinite(result.fix.latitude)) {
    ui.setBusy(refs.btnDownloadMap, true, 'Генериране…');
    let captured = null;
    try {
      captured = await captureMapForResult(result);
    } finally {
      ui.setBusy(refs.btnDownloadMap, false);
    }

    if (!captured) {
      ui.showToast(refs, 'Миникартата не можа да се генерира.', { timeout: 4000 });
      return;
    }

    mapBlob = captured.mapBlob;
    mapFilename = captured.mapFilename;

    // Keep it on the current result so "Запази в галерията" reuses this blob.
    setState({ result: { ...result, ...captured } });
    if (reviewMapUrl) URL.revokeObjectURL(reviewMapUrl);
    reviewMapUrl = URL.createObjectURL(mapBlob);
    ui.renderMapPreview(refs, reviewMapUrl, mapFilename, mapBlob);
    ui.updateDownloadButtons(refs, { hasMap: true, hasFix: true });
  }

  if (!mapBlob || !mapFilename) {
    ui.showToast(refs, 'Няма миникарта за тази снимка (липсва GPS fix).', { timeout: 4000 });
    return;
  }

  share.downloadBlob(mapBlob, mapFilename);
  ui.showToast(refs, `Изтеглена карта: ${mapFilename}`, { timeout: 4000 });
}

async function shareResult() {
  const result = getState().result;
  if (!result || !result.blob) return;

  // If there are drawing strokes, bake them into the image before sharing
  let blobToShare = result.blob;
  if (drawingController && drawingController.hasStrokes()) {
    ui.showToast(refs, 'Прилагане на анотации…', { timeout: 3000 });
    try {
      blobToShare = await drawingController.bake(result.blob);
    } catch (e) {
      console.error('Drawing bake failed:', e);
      ui.showToast(refs, 'Неуспешно прилагане на анотациите.');
    }
  }

  const file = new File([blobToShare], result.filename, { type: blobToShare.type || 'image/jpeg' });
  try {
    await share.shareFile(file, {
      title: 'Снимка с координати',
      text: summaryText(result),
    });
  } catch (error) {
    if (error?.name === 'AbortError') return;
    ui.showToast(refs, describeShareError(error));
  }
}

/** Copies the whole "navigation text": coordinates, directions link, Plus Code, address. */
async function copyCoordinates() {
  const result = getState().result;
  if (!result?.fix) {
    ui.showToast(refs, 'Няма координати за копиране.');
    return;
  }
  try {
    await share.copyText(summaryText(result));
    ui.showToast(refs, 'Координатите и линкът са копирани.', { timeout: 5000 });
  } catch (error) {
    ui.showToast(refs, error instanceof Error ? error.message : 'Копирането не успя.');
  }
}

/**
 * Copies exactly `41.887234, 24.712345` - the one format Google Maps parses when it
 * is pasted into the search box (also recognised by chat apps and car navigation).
 */
async function copyNavigationCoordinates() {
  const fix = getState().result?.fix;
  if (!Number.isFinite(fix?.latitude) || !Number.isFinite(fix?.longitude)) {
    ui.showToast(refs, 'Няма координати за копиране.');
    return;
  }
  try {
    await share.copyText(plainCoordinates(fix.latitude, fix.longitude));
    ui.showToast(refs, 'Копирано — постави го в Google Maps.', { timeout: 5000 });
  } catch (error) {
    ui.showToast(refs, error instanceof Error ? error.message : 'Копирането не успя.');
  }
}

/** Hands the coordinates to the maps app and starts navigation. */
function navigateToPhoto() {
  const fix = getState().result?.fix;
  if (!Number.isFinite(fix?.latitude) || !Number.isFinite(fix?.longitude)) {
    ui.showToast(refs, 'Няма координати за навигация.');
    return;
  }
  void openNavigationLinks(navigationLinks(fix.latitude, fix.longitude));
}

/**
 * Opens the first URL that actually leaves the page.
 *
 * Custom schemes (`geo:`, `maps://`, `comgooglemaps://`) are silently ignored when the
 * matching app is not installed, so they are tried in order: the page is watched for a
 * short moment and the next URL is used when nothing happened (standard deep-link dance).
 */
async function openNavigationLinks(links) {
  const list = Array.isArray(links) ? links.filter(Boolean) : [];
  for (let index = 0; index < list.length; index += 1) {
    const url = list[index];
    const isLast = index === list.length - 1;

    if (/^https?:/i.test(url)) {
      openExternal(url);
      return;
    }
    if ((await tryOpenCustomScheme(url)) || isLast) return;
  }
}

/** Fires a custom-scheme URL; resolves true when the browser navigated away from us. */
function tryOpenCustomScheme(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (leftPage) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resolve(leftPage);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finish(true);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    // Same-tab navigation: custom schemes never open a new tab.
    window.location.href = url;
    setTimeout(() => finish(document.visibilityState === 'hidden'), 1200);
  });
}

/**
 * Shows the QR code of the current photo (the Google Maps link) so another phone can
 * scan it straight off the screen.
 */
async function toggleQrPanel() {
  const fix = getState().result?.fix;
  if (!Number.isFinite(fix?.latitude) || !Number.isFinite(fix?.longitude)) {
    ui.showToast(refs, 'Няма координати за QR код.');
    return;
  }
  if (!refs.qrPanel) return;

  // Second tap closes the panel again.
  if (!refs.qrPanel.hidden) {
    ui.renderQrPanel(refs, null);
    if (refs.btnQr) refs.btnQr.textContent = 'Покажи QR';
    return;
  }

  ui.setBusy(refs.btnQr, true, 'Генериране…');
  let opened = false;
  try {
    const payload = qr.qrPayloadFor(fix.latitude, fix.longitude);
    const canvas = await qr.createQrCanvas(payload, { pixelSize: 240 });
    if (!canvas) {
      ui.showToast(
        refs,
        'QR кодът не е наличен — инсталирай пакета qrcode-generator (npm install).',
        { timeout: 7000 },
      );
      return;
    }
    ui.renderQrPanel(refs, canvas, payload);
    opened = true;
  } catch (error) {
    ui.showToast(refs, error instanceof Error ? error.message : 'QR кодът не можа да се създаде.');
  } finally {
    ui.setBusy(refs.btnQr, false);
    // setBusy restores the label it captured, so the final label is set last.
    if (refs.btnQr) refs.btnQr.textContent = opened ? 'Скрий QR' : 'Покажи QR';
  }
}

function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/* ----------------------------------------------------------------- gallery */

function revokeGalleryUrls() {
  for (const urls of galleryUrls.values()) {
    URL.revokeObjectURL(urls.photo);
    if (urls.thumb && urls.thumb !== urls.photo) URL.revokeObjectURL(urls.thumb);
    // NEW: Revoke map URLs
    if (urls.mapPhoto) URL.revokeObjectURL(urls.mapPhoto);
    if (urls.mapThumb && urls.mapThumb !== urls.mapPhoto) URL.revokeObjectURL(urls.mapThumb);
  }
  galleryUrls.clear();
}

async function refreshGallery() {
  if (!storage.isAvailable()) return;
  const grouped = await storage.listPhotosGrouped();

  revokeGalleryUrls();
  // Flatten for URL management (keep backward compatibility for openGalleryItem)
  const allRecords = grouped.flatMap(week => week.days.flatMap(day => day.photos));
  for (const record of allRecords) {
    const photo = URL.createObjectURL(record.blob);
    const thumb = record.thumb ? URL.createObjectURL(record.thumb) : photo;
    
    // NEW: Map URLs
    let mapPhoto = null, mapThumb = null;
    if (record.hasMap && record.mapBlob) {
      mapPhoto = URL.createObjectURL(record.mapBlob);
      mapThumb = record.mapThumb ? URL.createObjectURL(record.mapThumb) : mapPhoto;
    }
    
    galleryUrls.set(record.id, { photo, thumb, mapPhoto, mapThumb });
    record.url = photo;
    record.thumbUrl = thumb;
    record.mapUrl = mapPhoto;
    record.mapThumbUrl = mapThumb;
  }

  ui.setGalleryVisible(refs, true);
  ui.renderGallery(refs, grouped, { onOpen: openGalleryItem, onDelete: deleteGalleryItem });
}

/**
 * Captures the on-screen Leaflet mini-map into a WebP blob (with a GPS watermark
 * burned into the pixels) and returns the map fields for a photo record.
 *
 * Used by both "Запази в галерията" and the on-demand "Изтегли карта" button, so a
 * freshly taken photo can get its map without a round-trip through the gallery.
 *
 * @returns {Promise<{mapBlob: Blob, mapThumb: Blob|null, mapSize: number,
 *                    mapFilename: string, hasMap: true}|null>}
 */
async function captureMapForResult(result) {
  if (!result?.fix || !Number.isFinite(result.fix.latitude)) return null;

  try {
    // Make sure the Leaflet map is laid out and painted before we rasterise it.
    if (refs.map && !refs.map.hidden) {
      mapModule.invalidateSize();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const capture = await mapCapture.captureMapAsBlob(
      refs.map,
      result.fix,
      getState().address,
      result.capturedAt,
    );
    if (!capture?.blob) {
      console.warn('captureMapForResult: map capture returned no blob');
      return null;
    }

    const mapBlob = capture.blob;
    const mapThumb = await createThumbnail(mapBlob).catch((error) => {
      console.warn('Map thumbnail creation failed:', error);
      return null;
    });

    return {
      mapBlob,
      mapThumb,
      mapSize: mapBlob.size,
      mapFilename: `MAP_${result.filename.replace(/\.jpe?g$/i, '.webp')}`,
      hasMap: true,
    };
  } catch (error) {
    console.error('captureMapForResult failed:', error);
    return null;
  }
}

async function saveToGallery() {
  let result = getState().result;
  if (!result) {
    console.error('saveToGallery: no result in state');
    ui.showToast(refs, 'Няма снимка за запазване.');
    return;
  }
  if (!result.blob) {
    console.error('saveToGallery: result.blob is missing', result);
    ui.showToast(refs, 'Грешка: липсва файла на снимката.');
    return;
  }
  if (!storage.isAvailable()) {
    ui.showToast(refs, 'IndexedDB не е достъпен — запазването е невъзможно.');
    return;
  }

  // A photo opened from the gallery already owns a record: update its comment in
  // place instead of writing a second copy of the same photo + map.
  if (result.recordId) {
    await updateSavedComment();
    return;
  }

  // The comment may have been edited in the review after the shutter was pressed:
  // bring the JPEG in sync first, so the file, the record and the EXIF agree.
  const synced = await syncPhotoComment(result);
  if (synced) result = applySyncedComment(result, synced);

  // If there are drawing strokes, bake them into the image blob
  if (drawingController && drawingController.hasStrokes()) {
    ui.setBusy(refs.btnSave, true, 'Прилагане на анотации…');
    try {
      const bakedBlob = await drawingController.bake(result.blob);
      result = { ...result, blob: bakedBlob, size: bakedBlob.size };
      // Update the displayed image to show baked version
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
      reviewUrl = URL.createObjectURL(bakedBlob);
      ui.renderReviewPhoto(refs, reviewUrl);
      ui.renderMeta(refs, buildMetaRows(result, result.device ?? null, result.address ?? getState().address));
    } catch (e) {
      console.error('Drawing bake failed:', e);
      ui.showToast(refs, 'Неуспешно прилагане на анотациите.');
    }
  }

  ui.setBusy(refs.btnSave, true, 'Запазване…');
  try {
    const thumb = await createThumbnail(result.blob).catch((e) => {
      console.warn('Thumbnail creation failed:', e);
      return null;
    });

    // Reuse an already captured map (e.g. the user pressed "Изтегли карта" first),
    // otherwise capture it now if the shot has a GPS fix.
    const existingMap = result.hasMap && result.mapBlob
      ? {
          mapBlob: result.mapBlob,
          mapThumb: result.mapThumb ?? null,
          mapSize: result.mapSize ?? result.mapBlob.size,
          mapFilename: result.mapFilename,
          hasMap: true,
        }
      : null;

    let mapFields = existingMap;
    if (!mapFields) {
      mapFields = await captureMapForResult(result);
      if (!mapFields && result.fix && Number.isFinite(result.fix.latitude)) {
        ui.showToast(refs, 'Миникартата не бе генерирана (виж конзолата за детайли)', {
          timeout: 4000,
        });
      }
    }

    const photoRecord = {
      id: globalThis.crypto?.randomUUID?.() ?? `photo-${Date.now()}`,
      createdAt: result.capturedAt.getTime(),
      latitude: result.fix?.latitude ?? null,
      longitude: result.fix?.longitude ?? null,
      accuracy: result.fix?.accuracy ?? null,
      altitude: result.fix?.altitude ?? null,
      address: result.address ?? getState().address ?? null,
      // Third element of the record: photo + mini-map + comment live in one object,
      // so `deletePhoto(id)` always removes all three of them together.
      comment: normalizeComment(result.comment),
      commentUpdatedAt: hasComment(result.comment) ? Date.now() : null,
      // The text that actually sits in the JPEG (XPComment) - kept so a later save
      // can tell whether the file still matches the comment.
      exifComment: result.exifComment ?? normalizeComment(result.comment),
      schemaVersion: 2,
      source: result.source,
      watermarked: Boolean(result.watermarked),
      exifApplied: Boolean(result.exif.applied),
      gpsWritten: Boolean(result.exif.gpsWritten),
      filename: result.filename,
      size: result.size,
      blob: result.blob,
      thumb,
      // Map fields (null when there is no fix / the capture failed)
      mapBlob: mapFields?.mapBlob ?? null,
      mapThumb: mapFields?.mapThumb ?? null,
      mapFilename: mapFields?.mapFilename ?? null,
      mapSize: mapFields?.mapSize ?? null,
      hasMap: Boolean(mapFields?.mapBlob),
    };

    console.log('Saving photo record:', {
      id: photoRecord.id,
      filename: photoRecord.filename,
      hasBlob: !!photoRecord.blob,
      blobType: photoRecord.blob?.type,
      blobSize: photoRecord.blob?.size,
      hasMap: photoRecord.hasMap,
      mapBlobSize: photoRecord.mapBlob?.size,
      hasComment: hasComment(photoRecord.comment),
    });

    await storage.savePhoto(photoRecord);

    // Remember the id so a second press updates the comment instead of writing a
    // duplicate, and clear the draft under the shutter - the text now belongs to
    // this photo (the result keeps its own frozen copy).
    setState({ result: { ...result, recordId: photoRecord.id }, comment: '' });
    ui.renderReviewComment(refs, { comment: photoRecord.comment, saved: true });
    ui.renderStageComment(refs, '');

    await refreshGallery();

    const stored = ['снимката'];
    if (mapFields?.mapBlob) stored.push('картата');
    if (hasComment(photoRecord.comment)) stored.push('коментарът');
    ui.showToast(refs, `Запазени в галерията: ${stored.join(', ')}.`);
  } catch (error) {
    console.error('saveToGallery error:', error);
    ui.showToast(refs, error instanceof Error ? error.message : 'Запазването не успя.');
  } finally {
    // setBusy(false) restores the previous label, so the label is re-rendered from
    // the current state right after it (a saved photo now updates its comment).
    ui.setBusy(refs.btnSave, false);
    const hasDrawing = drawingController && drawingController.hasStrokes();
    ui.renderSaveLabel(refs, { saved: Boolean(getState().result?.recordId), hasDrawingChanges: hasDrawing });
  }
}

/**
 * Writes the (possibly edited) comment of the current result into its JPEG.
 *
 * The comment is typed before the shutter, but it can also be edited in the review
 * afterwards - this keeps the file in sync with the text, so a later download or
 * share carries exactly the comment shown in the app.
 *
 * @param {object} result
 * @returns {Promise<{ blob: Blob, comment: string }|null>} null when the file is fine
 */
async function syncPhotoComment(result) {
  const comment = normalizeComment(result?.comment);
  if (comment === (result?.exifComment ?? '')) return null;
  if (!result?.blob) return null;

  const patched = await exif.writeCommentToBlob(result.blob, comment);
  if (!patched.applied) {
    if (patched.reason && patched.reason !== 'без промяна') {
      console.warn('Коментарът не влезе в EXIF:', patched.reason);
      return null;
    }
  }
  return { blob: patched.blob, comment };
}

/**
 * Stores a synced result back into the state and refreshes the rows that depend on
 * the file (size), so the review card never lies about what is on disk.
 */
function applySyncedComment(result, synced) {
  const next = {
    ...result,
    comment: synced.comment,
    exifComment: synced.comment,
    blob: synced.blob,
    size: synced.blob.size,
    // The tag was patched after the capture, so the read-back check no longer
    // describes this exact text - be honest about it in the review card.
    commentVerified: null,
  };
  setState({ result: next });
  ui.renderMeta(refs, buildMetaRows(next, next.device ?? null, getState().address));
  return next;
}

/**
 * "Запази коментара" for a record that already exists in the gallery.
 *
 * Only the comment field of the existing record is rewritten: the photo and the
 * mini-map blobs stay byte-identical, so the triple still cannot drift apart.
 */
async function updateSavedComment() {
  const result = getState().result;
  if (!result?.recordId) return;

  ui.setBusy(refs.btnSave, true, 'Запазване…');
  try {
    const comment = normalizeComment(result.comment);
    const synced = await syncPhotoComment(result);

    // If there are drawing strokes, bake them into the image blob first
    let blobToSave = result.blob;
    let sizeToSave = result.size;
    if (drawingController && drawingController.hasStrokes()) {
      ui.setBusy(refs.btnSave, true, 'Прилагане на анотации…');
      try {
        const bakedBlob = await drawingController.bake(result.blob);
        blobToSave = bakedBlob;
        sizeToSave = bakedBlob.size;
        // Update the displayed image to show baked version
        if (reviewUrl) URL.revokeObjectURL(reviewUrl);
        reviewUrl = URL.createObjectURL(bakedBlob);
        ui.renderReviewPhoto(refs, reviewUrl);
        ui.renderMeta(refs, buildMetaRows(result, result.device ?? null, result.address ?? getState().address));
      } catch (e) {
        console.error('Drawing bake failed:', e);
        ui.showToast(refs, 'Неуспешно прилагане на анотациите.');
      }
    }

    // Only the comment changes unless the edited text also had to go into the JPEG.
    const updated = synced
      ? await storage.updatePhoto(result.recordId, {
          comment,
          commentUpdatedAt: Date.now(),
          blob: synced.blob,
          size: synced.blob.size,
          exifComment: synced.comment,
        })
      : await storage.updatePhoto(result.recordId, {
          comment,
          commentUpdatedAt: Date.now(),
          blob: blobToSave,
          size: sizeToSave,
        });

    if (!updated) {
      // The record was deleted in another tab: fall back to "save as new".
      setState({ result: { ...result, recordId: null } });
      ui.renderReviewComment(refs, { comment: result.comment ?? '', saved: false });
      ui.showToast(refs, 'Снимката вече не е в галерията — запиши я отново.');
      await refreshGallery();
      return;
    }

    if (synced) {
      applySyncedComment(result, synced);
    } else {
      setState({ result: { ...result, comment, blob: blobToSave, size: sizeToSave } });
    }
    ui.renderReviewComment(refs, { comment, saved: true });
    await refreshGallery();
    ui.showToast(refs, hasComment(comment) ? 'Коментарът е обновен.' : 'Коментарът е премахнат.', {
      timeout: 4000,
    });
  } catch (error) {
    console.error('updateSavedComment error:', error);
    ui.showToast(refs, error instanceof Error ? error.message : 'Обновяването не успя.');
  } finally {
    ui.setBusy(refs.btnSave, false);
    const hasDrawing = drawingController && drawingController.hasStrokes();
    ui.renderSaveLabel(refs, { saved: Boolean(getState().result?.recordId), hasDrawingChanges: hasDrawing });
  }
}

function openGalleryItem(record) {
  const fix = Number.isFinite(record.latitude)
    ? {
        latitude: record.latitude,
        longitude: record.longitude,
        accuracy: record.accuracy ?? null,
        altitude: record.altitude ?? null,
        timestamp: record.createdAt,
      }
    : null;

  showResult(
    {
      blob: record.blob,
      /** Existing record: "Запази коментара" updates it instead of duplicating. */
      recordId: record.id,
      comment: record.comment ?? '',
      exifComment: record.exifComment ?? '',
      fix,
      capturedAt: new Date(record.createdAt),
      source: record.source ?? 'gallery',
      watermarked: Boolean(record.watermarked),
      size: record.size ?? record.blob.size,
      filename: record.filename ?? 'photo.jpg',
      exif: {
        applied: Boolean(record.exifApplied),
        gpsWritten: Boolean(record.gpsWritten),
        commentWritten: Boolean(record.comment),
        reason: 'от галерията',
      },
      /** The file was written earlier - only a fresh capture verifies the tag. */
      commentVerified: null,
      verification: {
        verified: Boolean(record.gpsWritten),
        distance: null,
        reason: record.gpsWritten ? undefined : 'не е проверявано',
      },
      // NEW: Map data
      mapBlob: record.mapBlob ?? null,
      mapThumb: record.mapThumb ?? null,
      mapFilename: record.mapFilename ?? null,
      mapSize: record.mapSize ?? null,
      hasMap: Boolean(record.hasMap),
    },
    { address: record.address ?? null },
  );
}

async function deleteGalleryItem(record) {
  // Explicit confirmation: the photo, its mini-map and its comment are one record
  // and disappear together, so the user should not be surprised by the sweep.
  const confirmed = globalThis.confirm?.(
    'Да изтрия ли снимката?\n\nЗаедно с нея ще се изтрият миникартата и коментарът.',
  );
  if (confirmed === false) return;

  await storage.deletePhoto(record.id);
  const urls = galleryUrls.get(record.id);
  if (urls) {
    URL.revokeObjectURL(urls.photo);
    if (urls.thumb !== urls.photo) URL.revokeObjectURL(urls.thumb);
    // NEW: Revoke map URLs
    if (urls.mapPhoto) URL.revokeObjectURL(urls.mapPhoto);
    if (urls.mapThumb && urls.mapThumb !== urls.mapPhoto) URL.revokeObjectURL(urls.mapThumb);
    galleryUrls.delete(record.id);
  }
  await refreshGallery();
  ui.showToast(refs, 'Снимката, миникартата и коментарът са изтрити.');
}

async function clearGallery() {
  // Same wording as a single delete: the comment belongs to the photo, so it goes too.
  const confirmed = globalThis.confirm?.(
    'Да изчистя ли цялата галерия?\n\nВсяка снимка ще бъде изтрита заедно със своята миникарта и коментар.',
  );
  if (confirmed === false) return;

  await storage.clearPhotos();
  await refreshGallery();
  ui.showToast(refs, 'Галерията е изчистена (снимки, карти и коментари).');
}

/* ------------------------------------------------------- wiring and bootstrap */

function wireEvents() {
  refs.btnStart?.addEventListener('click', () => void startCameraFlow());
  refs.btnNative?.addEventListener('click', () => void captureFromNativeCamera());
  refs.btnImport?.addEventListener('click', () => void pickImportFile());
  refs.btnShutter?.addEventListener('click', () => void captureFromCamera());
  refs.btnSwitch?.addEventListener('click', () => void toggleCamera());

  refs.btnTorch?.addEventListener('click', async () => {
    const enabled = refs.btnTorch.getAttribute('aria-pressed') === 'true';
    try {
      await camera.setTorch(!enabled);
      refs.btnTorch.setAttribute('aria-pressed', String(!enabled));
    } catch {
      ui.showToast(refs, 'Светкавицата не е достъпна на тази камера.');
    }
  });

  refs.zoomRange?.addEventListener('input', () => {
    void camera.setZoom(refs.zoomRange.value).catch(() => {});
  });

  refs.chkWatermark?.addEventListener('change', () => {
    setState({ watermark: refs.chkWatermark.checked });
  });

  // The QR code is drawn into the pixels, so it needs the watermark (canvas) path.
  refs.chkQr?.addEventListener('change', () => {
    const enabled = refs.chkQr.checked;
    setState({ qr: enabled });
    if (enabled && refs.chkWatermark && !refs.chkWatermark.checked) {
      refs.chkWatermark.checked = true;
      setState({ watermark: true });
    }
  });

  // A photo from another app can be dropped on the page or pasted (Ctrl+V).
  document.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', (event) => {
    const file = [...(event.dataTransfer?.files ?? [])].find((item) =>
      item.type?.startsWith('image/'),
    );
    if (!file) return;
    event.preventDefault();
    void importPhoto(file);
  });

  document.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((item) =>
      item.type?.startsWith('image/'),
    );
    if (!file) return;
    event.preventDefault();
    void importPhoto(file);
  });

  // Comment draft under the shutter. It is NOT normalised while typing (that would
  // move the caret around); the frozen copy is normalised when the shutter fires.
  refs.commentInput?.addEventListener('input', () => {
    setState({ comment: refs.commentInput.value });
    ui.updateCommentCount(refs, refs.commentInput.value);
  });

  // Comment of the review card feeds the result that "Запази в галерията" stores.
  refs.reviewComment?.addEventListener('input', () => {
    const result = getState().result;
    if (result) setState({ result: { ...result, comment: refs.reviewComment.value } });
  });

  refs.btnDownload?.addEventListener('click', () => downloadPhoto());
  refs.btnDownloadMap?.addEventListener('click', () => void downloadMap());
  refs.btnNavigate?.addEventListener('click', () => navigateToPhoto());
  refs.btnCopyNav?.addEventListener('click', () => void copyNavigationCoordinates());
  refs.btnQr?.addEventListener('click', () => void toggleQrPanel());
  refs.btnShare?.addEventListener('click', () => void shareResult());
  refs.btnCopy?.addEventListener('click', () => void copyCoordinates());
  refs.btnSave?.addEventListener('click', () => void saveToGallery());
  refs.btnGalleryClear?.addEventListener('click', () => void clearGallery());

  refs.btnOsm?.addEventListener('click', () => {
    const fix = getState().result?.fix;
    if (fix) openExternal(osmUrl(fix.latitude, fix.longitude));
  });

  refs.btnGoogle?.addEventListener('click', () => {
    const fix = getState().result?.fix;
    if (fix) openExternal(googleMapsUrl(fix.latitude, fix.longitude));
  });

  refs.btnNew?.addEventListener('click', () => {
    clearResult();
    void wakelock.acquireWakeLock();
    refs.stage?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', () => {
    clearInterval(hudTimer);
    stopGps();
    void wakelock.releaseWakeLock();
  });
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    void wakelock.releaseWakeLock();
    return;
  }
  if (getState().camera === CAMERA_STATES.ON) void wakelock.acquireWakeLock();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch {
    /* dev server without the PWA plugin - nothing to register */
  }
}

function init() {
  guardEnvironment();
  wireEvents();
  subscribe(renderAll);

  // Clear geocode memory cache since we changed the language from Bulgarian to German
  clearMemoryCache();
  // Also clear the persistent IndexedDB cache to force fresh geocoding requests
  storage.clearGeocodeCache();

  if (refs.chkWatermark) {
    refs.chkWatermark.checked = true;
    setState({ watermark: true });
  }

  // Draft comment: show the initial "0/500" counter without touching the field on
  // every render (renderAll must never fight the phone keyboard for the caret).
  ui.renderStageComment(refs, getState().comment);

  // Keeps the "fix преди N с" counter live without re-rendering on every event.
  hudTimer = setInterval(renderAll, 1000);

  wakelock.keepAwakeWhileVisible();

  // Warm the GPS up quietly so a fix is ready by the time the user starts.
  startGps({ quiet: true });

  renderAll();
  void refreshGallery();
  void pickUpSharedPhoto();
  void registerServiceWorker();
}

init();
