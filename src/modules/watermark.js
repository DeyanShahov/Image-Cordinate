/**
 * Optional watermark: burns the coordinates, accuracy, timestamp and address into
 * the pixels, so the information survives screenshots and messaging apps.
 *
 * This is the only code path that re-encodes the photo (canvas -> JPEG). It is
 * capped at `maxEdge` pixels so a 48 MP photo cannot exhaust phone memory, and it
 * always runs on a copy - the untouched original stays available.
 */

import { canvasToBlob, createCanvas, decodeImage, imageSize } from '../utils/image.js';
import {
  formatAccuracy,
  formatAltitude,
  formatDateTime,
  formatDecimal,
  formatDms,
} from '../utils/coords.js';

function roundRect(context, x, y, width, height, radius) {
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapText(context, text, maxWidth, maxLines = 2) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.join(' ').length < String(text).length) {
    lines[maxLines - 1] = `${lines[maxLines - 1] ?? ''}…`;
  }
  return lines;
}

/**
 * @param {Blob} blob JPEG/PNG source
 * @param {{ fix?: object|null, address?: string|null, capturedAt?: Date,
 *           maxEdge?: number, quality?: number, brand?: string }} options
 * @returns {Promise<{ blob: Blob, scaled: boolean, width: number, height: number }>}
 */
export async function withWatermark(blob, options = {}) {
  const {
    fix = null,
    address = null,
    capturedAt = new Date(),
    maxEdge = 4096,
    quality = 0.92,
    brand = 'Image Coordinate',
  } = options;

  const image = await decodeImage(blob);
  const source = imageSize(image);
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context недостъпен.');
  context.drawImage(image, 0, 0, width, height);
  if (typeof image.close === 'function') image.close();

  const hasFix = Boolean(fix && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude));
  const padding = Math.round(width * 0.035);
  const coordSize = Math.max(16, Math.round(width / 30));
  const metaSize = Math.max(12, Math.round(width / 55));
  const lineHeight = Math.round(coordSize * 1.35);

  const lines = [];
  lines.push({ text: hasFix ? formatDecimal(fix.latitude, fix.longitude) : 'Без GPS координати', size: coordSize, weight: '700' });
  if (hasFix) lines.push({ text: formatDms(fix.latitude, fix.longitude), size: metaSize, weight: '500' });
  const metaBits = [];
  if (hasFix && Number.isFinite(fix.accuracy)) metaBits.push(`точност ${formatAccuracy(fix.accuracy)}`);
  if (hasFix && Number.isFinite(fix.altitude)) metaBits.push(formatAltitude(fix.altitude));
  metaBits.push(formatDateTime(capturedAt));
  lines.push({ text: metaBits.join(' · '), size: metaSize, weight: '500' });
  lines.push({ text: brand, size: Math.max(10, Math.round(metaSize * 0.85)), weight: '600' });

  context.font = `${metaSize}px system-ui, sans-serif`;
  const maxTextWidth = width - padding * 2;
  const addressLines = address ? wrapText(context, address, maxTextWidth, 2) : [];
  for (const line of addressLines) {
    lines.push({ text: line, size: metaSize, weight: '400' });
  }

  const panelHeight =
    lines.reduce((total, line) => total + Math.round(line.size * 1.45), 0) + padding * 1.4;
  const panelY = height - panelHeight - padding / 2;

  context.save();
  const gradient = context.createLinearGradient(0, panelY, 0, height);
  gradient.addColorStop(0, 'rgba(4, 8, 16, 0)');
  gradient.addColorStop(0.35, 'rgba(4, 8, 16, 0.6)');
  gradient.addColorStop(1, 'rgba(4, 8, 16, 0.88)');
  context.fillStyle = gradient;
  context.fillRect(0, Math.max(0, panelY - padding), width, height - Math.max(0, panelY - padding));
  context.restore();

  roundRect(
    context,
    padding * 0.6,
    panelY - padding * 0.3,
    width - padding * 1.2,
    panelHeight,
    Math.round(padding * 0.45),
  );
  context.fillStyle = 'rgba(6, 10, 20, 0.55)';
  context.fill();
  context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  context.lineWidth = Math.max(1, width / 1400);
  context.stroke();

  context.save();
  context.textBaseline = 'top';
  context.shadowColor = 'rgba(0, 0, 0, 0.55)';
  context.shadowBlur = Math.round(metaSize * 0.5);
  let cursorY = panelY + padding * 0.35;
  for (const line of lines) {
    context.font = `${line.weight} ${line.size}px ${
      line.weight === '700' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'system-ui, sans-serif'
    }`;
    context.fillStyle = line.weight === '700' ? '#ffffff' : 'rgba(240, 246, 255, 0.92)';
    context.fillText(line.text, padding, cursorY);
    cursorY += Math.round(line.size * 1.45);
  }
  context.restore();

  const watermarked = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob: watermarked, scaled: scale < 1, width, height };
}
