/**
 * Camera: MediaStream lifecycle, device switching, torch/zoom and still capture.
 *
 * Capture strategy (see README):
 *   1. ImageCapture.takePhoto() - full resolution still, Chrome/Edge/Android.
 *   2. <video> -> canvas -> toBlob() - the only path on iOS Safari, which does
 *      not implement ImageCapture at all.
 */

let currentStream = null;

export function isSupported() {
  return Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);
}

export function isImageCaptureSupported() {
  return typeof globalThis.ImageCapture === 'function';
}

export function getCurrentStream() {
  return currentStream;
}

export function stopStream(stream = currentStream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
  if (stream === currentStream) currentStream = null;
}

export async function listVideoInputs() {
  if (!globalThis.navigator?.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'videoinput');
}

/**
 * @param {{ facingMode?: 'environment'|'user', deviceId?: string,
 *           width?: number, height?: number }} options
 */
export async function startStream(options = {}) {
  const { facingMode = 'environment', deviceId, width = 3840, height = 2160 } = options;

  stopStream();

  const video = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height } }
    : {
        // `ideal` (not `exact`) - iOS Safari fails with `exact` on some devices.
        facingMode: { ideal: facingMode },
        width: { ideal: width },
        height: { ideal: height },
      };

  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  currentStream = stream;
  return stream;
}

export async function attachStream(stream, videoEl) {
  videoEl.srcObject = stream;
  videoEl.muted = true;
  try {
    await videoEl.play();
  } catch {
    /* autoplay may need a user gesture; the preview still shows once tapped */
  }
}

export function getVideoTrack(stream = currentStream) {
  return stream?.getVideoTracks?.()[0] ?? null;
}

export function getCapabilities(track = getVideoTrack()) {
  return track?.getCapabilities?.() ?? {};
}

export async function setTorch(on, track = getVideoTrack()) {
  if (!track) return false;
  await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
  return Boolean(on);
}

export async function setZoom(value, track = getVideoTrack()) {
  if (!track) return false;
  
  const capabilities = track.getCapabilities?.();
  if (capabilities?.zoom) {
    const min = capabilities.zoom.min;
    const max = capabilities.zoom.max;
    const clampedValue = Math.max(min, Math.min(max, Number(value)));
    if (clampedValue !== Number(value)) {
      console.warn(`Zoom value ${value} clamped to ${clampedValue} (range: ${min}-${max})`);
    }
    await track.applyConstraints({ advanced: [{ zoom: clampedValue }] });
  } else {
    await track.applyConstraints({ advanced: [{ zoom: Number(value) }] });
  }
  return true;
}

export async function switchCamera(videoEl, deviceId) {
  const stream = await startStream({ deviceId });
  await attachStream(stream, videoEl);
  return stream;
}

/**
 * Capture a still frame.
 * @returns {Promise<{ blob: Blob, source: 'image-capture'|'canvas', width?: number,
 *                     height?: number }>}
 */
export async function captureFrame(track, videoEl) {
  if (isImageCaptureSupported() && track) {
    try {
      const photo = await new globalThis.ImageCapture(track).takePhoto();
      if (photo?.type === 'image/jpeg' && photo.size > 0) {
        const bitmap = await createImageBitmap(photo).catch(() => null);
        return {
          blob: photo,
          source: 'image-capture',
          width: bitmap?.width,
          height: bitmap?.height,
        };
      }
    } catch {
      /* NotSupportedError / NotReadableError -> fall back to the canvas path */
    }
  }
  return { blob: await grabFrame(track, videoEl), source: 'canvas' };
}

async function grabFrame(track, videoEl) {
  const settings = track?.getSettings?.() ?? {};
  const width = settings.width || videoEl.videoWidth || 1280;
  const height = settings.height || videoEl.videoHeight || 720;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D context недостъпен на това устройство.');

  // Front camera previews are mirrored - keep the captured frame consistent.
  if (track?.getSettings?.().facingMode === 'user') {
    context.translate(width, 0);
    context.scale(-1, 1);
  }

  context.drawImage(videoEl, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) throw new Error('Неуспешно кодиране на кадъра (canvas.toBlob).');
  return blob;
}
