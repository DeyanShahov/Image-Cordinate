/**
 * Captures Leaflet map as WebP image with GPS watermark.
 * Called at gallery-save time only.
 */

import { canvasToBlob, createCanvas } from '../utils/image.js';
import { formatAccuracy, formatDateTime, formatDecimal } from '../utils/coords.js';

const MAP_MAX_DIMENSION = 512;  // Cap for cloud upload efficiency
const MAP_WEBP_QUALITY = 0.82;  // Good quality/size balance

function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export async function captureMapAsBlob(mapContainer, fix, address, capturedAt) {
  if (!mapContainer || !fix) return null;

  // 1. Use leaflet-image to render map to canvas
  let leafletImage;
  try {
    const module = await import('leaflet-image');
    leafletImage = module.default ?? module;
  } catch (e) {
    console.error('leaflet-image failed to load:', e);
    return null;
  }

  const canvas = await new Promise((resolve, reject) => {
    leafletImage(mapContainer, (err, canvas) => {
      if (err) reject(err);
      else resolve(canvas);
    });
  });

  // 2. Resize if needed (cap at MAP_MAX_DIMENSION)
  const scale = Math.min(1, MAP_MAX_DIMENSION / Math.max(canvas.width, canvas.height));
  const width = Math.round(canvas.width * scale);
  const height = Math.round(canvas.height * scale);
  
  const finalCanvas = createCanvas(width, height);
  const ctx = finalCanvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, width, height);

  // 3. Add compact GPS watermark (bottom-right, semi-transparent)
  if (Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)) {
    const padding = Math.round(width * 0.025);
    const fontSize = Math.max(11, Math.round(width / 45));
    const lineHeight = Math.round(fontSize * 1.4);
    
    const lines = [
      formatDecimal(fix.latitude, fix.longitude),
      Number.isFinite(fix.accuracy) ? `±${Math.round(fix.accuracy)}m` : null,
      formatDateTime(capturedAt),
    ].filter(Boolean);

    // Measure text width for panel sizing
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const panelWidth = lines.reduce((max, line) => 
      Math.max(max, ctx.measureText(line).width), 0) + padding * 2;
    const panelHeight = lines.length * lineHeight + padding * 1.5;
    const panelX = width - panelWidth - padding;
    const panelY = height - panelHeight - padding;

    // Background
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    roundRect(ctx, panelX, panelY, panelWidth, panelHeight, 6);
    ctx.fill();
    ctx.restore();

    // Text
    ctx.save();
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.textBaseline = 'top';
    let y = panelY + padding * 0.5;
    for (const line of lines) {
      ctx.fillText(line, panelX + padding, y);
      y += lineHeight;
    }
    ctx.restore();
  }

  // 4. Convert to WebP blob
  const webpBlob = await canvasToBlob(finalCanvas, 'image/webp', MAP_WEBP_QUALITY);
  
  return {
    blob: webpBlob,
    width,
    height,
    format: 'webp'
  };
}