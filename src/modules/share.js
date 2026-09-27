/**
 * Download, native share sheet and clipboard helpers.
 */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser time to start the download before invalidating the URL.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function downloadBoth(photoBlob, photoFilename, mapBlob, mapFilename) {
  downloadBlob(photoBlob, photoFilename);
  if (mapBlob && mapFilename) {
    // Small delay to avoid browser blocking multiple downloads
    setTimeout(() => downloadBlob(mapBlob, mapFilename), 150);
  }
}

export function canShareFiles(file) {
  if (!file || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(file, { title, text } = {}) {
  if (!canShareFiles(file)) throw new Error('Споделянето на файлове не се поддържа.');
  await navigator.share({ files: [file], title, text });
}

export async function shareText({ title, text, url } = {}) {
  if (typeof navigator.share !== 'function') throw new Error('Споделянето не се поддържа.');
  await navigator.share({ title, text, url });
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  // Fallback for older WebKit / non-secure contexts.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand?.('copy') ?? false;
  area.remove();
  if (!ok) throw new Error('Копирането не е разрешено от браузъра.');
  return true;
}
