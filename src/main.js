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
  coordinateSummary,
  formatAccuracy,
  formatAltitude,
  formatBytes,
  formatDateTime,
  formatDms,
  googleMapsUrl,
  makePhotoFilename,
  osmUrl,
} from './utils/coords.js';
import { describeGeolocationError, describeMediaError, describeShareError } from './utils/errors.js';
import { createThumbnail } from './utils/image.js';
import * as camera from './modules/camera.js';
import * as exif from './modules/exif.js';
import { reverseGeocode } from './modules/geocode.js';
import * as geo from './modules/geolocation.js';
import * as mapModule from './modules/map.js';
import * as mapCapture from './modules/map-capture.js';
import { pickPhotoFile, readDeviceMetadata } from './modules/native-capture.js';
import * as share from './modules/share.js';
import * as storage from './modules/storage.js';
import * as ui from './modules/ui.js';
import * as wakelock from './modules/wakelock.js';
import * as watermark from './modules/watermark.js';

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

  // The fix is frozen at the exact moment the shutter was pressed.
  const fix = state.fix ? { ...state.fix } : null;
  const capturedAt = new Date();

  try {
    const track = camera.getVideoTrack();
    const frame = await camera.captureFrame(track, refs.video);
    const result = await processPhoto({
      blob: frame.blob,
      fix,
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
    const capturedAt = device.takenAt ?? new Date();
    const result = await processPhoto({
      blob: file,
      fix,
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
async function processPhoto({ blob, fix, capturedAt, source, pixelSize, device = null }) {
  const state = getState();
  let photo = blob;
  let watermarked = false;
  let targetSize = pixelSize;

  if (state.watermark) {
    try {
      const stamped = await watermark.withWatermark(photo, {
        fix,
        address: state.address,
        capturedAt,
      });
      photo = stamped.blob;
      watermarked = true;
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

  return {
    blob: exifResult.blob,
    fix,
    capturedAt,
    source,
    watermarked,
    device,
    exif: exifResult,
    verification,
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
};

function describeExif(result) {
  const { exif: exifResult, verification } = result;
  if (!exifResult.applied) return `не е записан (${exifResult.reason})`;
  if (!exifResult.gpsWritten) return 'обновен, но без GPS тагове';
  if (!verification.verified) return `записан, без потвърждение (${verification.reason})`;
  return `записан и проверен (Δ ${(verification.distance ?? 0).toFixed(2)} m)`;
}

function buildMetaRows(result, device, address) {
  const { fix, capturedAt } = result;
  return [
    [
      'Координати (DD)',
      fix ? `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}` : 'без GPS fix',
    ],
    ['Координати (DMS)', fix ? formatDms(fix.latitude, fix.longitude) : null],
    ['Точност', fix && Number.isFinite(fix.accuracy) ? formatAccuracy(fix.accuracy) : null],
    ['Надм. височина', fix && Number.isFinite(fix.altitude) ? formatAltitude(fix.altitude) : null],
    ['Адрес', address],
    ['Заснета', formatDateTime(capturedAt)],
    ['Източник', SOURCE_LABELS[result.source] ?? result.source],
    ['Камера (устройство)', device ? [device.make, device.model].filter(Boolean).join(' ') : null],
    ['EXIF GPS', describeExif(result)],
    ['Воден знак', result.watermarked ? 'да' : 'не'],
    ['Размер на файла', formatBytes(result.size)],
  ];
}

function showResult(result, { device = null, address = getState().address } = {}) {
  if (reviewUrl) URL.revokeObjectURL(reviewUrl);
  reviewUrl = URL.createObjectURL(result.blob);
  ui.renderReviewPhoto(refs, reviewUrl);
  ui.renderMeta(refs, buildMetaRows(result, device, address));
  ui.setReviewVisible(refs, true);

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

  // Update state FIRST so the download handlers read the correct result
  setState({ result, phase: PHASES.REVIEW });

  // Show/hide the two download buttons (photo always; map when a blob exists or a fix allows on-demand capture)
  ui.updateDownloadButtons(refs, {
    hasMap: Boolean(result.hasMap && result.mapBlob),
    hasFix: Boolean(result.fix && Number.isFinite(result.fix.latitude)),
  });

  refs.review?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearResult() {
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
  setState({ result: null, phase: PHASES.LIVE });
}

/* ----------------------------------------------------------------- actions */

function currentFile() {
  const result = getState().result;
  if (!result) return null;
  return new File([result.blob], result.filename, { type: result.blob.type || 'image/jpeg' });
}

function summaryText(result) {
  if (!result?.fix) return 'Снимка без GPS координати';
  return coordinateSummary(result.fix.latitude, result.fix.longitude, {
    accuracy: result.fix.accuracy,
    altitude: result.fix.altitude,
    timestamp: result.capturedAt.getTime(),
    address: getState().address,
  });
}

function downloadPhoto() {
  const result = getState().result;
  if (!result || !result.blob) return;

  share.downloadBlob(result.blob, result.filename);
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
  const file = currentFile();
  if (!result || !file) return;
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

async function copyCoordinates() {
  const result = getState().result;
  if (!result?.fix) {
    ui.showToast(refs, 'Няма координати за копиране.');
    return;
  }
  try {
    await share.copyText(summaryText(result));
    ui.showToast(refs, 'Координатите са копирани.');
  } catch (error) {
    ui.showToast(refs, error instanceof Error ? error.message : 'Копирането не успя.');
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
  const result = getState().result;
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
      address: getState().address ?? null,
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
    });

    await storage.savePhoto(photoRecord);
    await refreshGallery();
    ui.showToast(refs, 'Снимката' + (mapFields?.mapBlob ? ' и картата' : '') + ' са запазени в галерията.');
  } catch (error) {
    console.error('saveToGallery error:', error);
    ui.showToast(refs, error instanceof Error ? error.message : 'Запазването не успя.');
  } finally {
    ui.setBusy(refs.btnSave, false);
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
      fix,
      capturedAt: new Date(record.createdAt),
      source: record.source ?? 'gallery',
      watermarked: Boolean(record.watermarked),
      size: record.size ?? record.blob.size,
      filename: record.filename ?? 'photo.jpg',
      exif: {
        applied: Boolean(record.exifApplied),
        gpsWritten: Boolean(record.gpsWritten),
        reason: 'от галерията',
      },
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
  ui.showToast(refs, 'Снимката е изтрита.');
}

async function clearGallery() {
  await storage.clearPhotos();
  await refreshGallery();
  ui.showToast(refs, 'Галерията е изчистена.');
}

/* ------------------------------------------------------- wiring and bootstrap */

function wireEvents() {
  refs.btnStart?.addEventListener('click', () => void startCameraFlow());
  refs.btnNative?.addEventListener('click', () => void captureFromNativeCamera());
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

  refs.btnDownload?.addEventListener('click', () => downloadPhoto());
  refs.btnDownloadMap?.addEventListener('click', () => void downloadMap());
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

  if (refs.chkWatermark) {
    refs.chkWatermark.checked = true;
    setState({ watermark: true });
  }

  // Keeps the "fix преди N с" counter live without re-rendering on every event.
  hudTimer = setInterval(renderAll, 1000);

  wakelock.keepAwakeWhileVisible();

  // Warm the GPS up quietly so a fix is ready by the time the user starts.
  startGps({ quiet: true });

  renderAll();
  void refreshGallery();
  void registerServiceWorker();
}

init();
