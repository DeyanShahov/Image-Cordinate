/**
 * Drawing/Annotation module for the review phase.
 * Provides a non-destructive canvas overlay for freehand drawing on the captured photo.
 * Strokes are kept as vector data (serializable) and baked into the image only on export/save.
 */

import { decodeImage, createCanvas, canvasToBlob, imageSize } from '../utils/image.js';

// Fixed palette: 3 colors (red, blue, green) - high contrast on photos
export const DRAW_COLORS = Object.freeze([
  { value: '#e53935', label: 'Червен' },
  { value: '#1e88e5', label: 'Син' },
  { value: '#43a047', label: 'Зелен' },
]);

// Fixed stroke widths: thin, medium, thick (in CSS pixels on the displayed image)
export const DRAW_WIDTHS = Object.freeze([
  { value: 2, label: 'Тънка (2px)' },
  { value: 4, label: 'Средна (4px)' },
  { value: 8, label: 'Дебела (8px)' },
]);
/**
 * Creates a drawing controller bound to a canvas overlaying an image.
 * @param {HTMLCanvasElement} canvas - The overlay canvas (same display size as the image)
 * @param {number} imageNaturalWidth - Natural width of the underlying image (pixels)
 * @param {number} imageNaturalHeight - Natural height of the underlying image (pixels)
 * @returns {DrawingController}
 */
export function createDrawingController(canvas, imageNaturalWidth, imageNaturalHeight) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context недостъпен.');

  let displayWidth = 0;
  let displayHeight = 0;

  const strokes = [];
  const undoStack = [];

  let currentColor = DRAW_COLORS[0].value;
  let currentWidth = DRAW_WIDTHS[1].value;
  let isDrawing = false;
  let currentStroke = null;

  function toImageCoords(clientX, clientY, canvasRect) {
    const scaleX = imageNaturalWidth / displayWidth;
    const scaleY = imageNaturalHeight / displayHeight;
    return {
      x: (clientX - canvasRect.left) * scaleX,
      y: (clientY - canvasRect.top) * scaleY,
    };
  }

  function toDisplayCoords(x, y) {
    const scaleX = displayWidth / imageNaturalWidth;
    const scaleY = displayHeight / imageNaturalHeight;
    return { x: x * scaleX, y: y * scaleY };
  }

  function render() {
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width * (displayWidth / imageNaturalWidth);
      ctx.beginPath();
      const p0 = toDisplayCoords(stroke.points[0].x, stroke.points[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < stroke.points.length; i++) {
        const p = toDisplayCoords(stroke.points[i].x, stroke.points[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    if (currentStroke && currentStroke.points.length >= 2) {
      ctx.strokeStyle = currentStroke.color;
      ctx.lineWidth = currentStroke.width * (displayWidth / imageNaturalWidth);
      ctx.beginPath();
      const p0 = toDisplayCoords(currentStroke.points[0].x, currentStroke.points[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < currentStroke.points.length; i++) {
        const p = toDisplayCoords(currentStroke.points[i].x, currentStroke.points[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }
function setDisplaySize(width, height) {
    displayWidth = width;
    displayHeight = height;
    canvas.width = width;
    canvas.height = height;
    render();
  }

  function setColor(color) {
    if (DRAW_COLORS.some(c => c.value === color)) currentColor = color;
  }

  function setWidth(width) {
    if (DRAW_WIDTHS.some(w => w.value === width)) currentWidth = width;
  }

  function startStroke(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const pt = toImageCoords(clientX, clientY, rect);
    currentStroke = {
      points: [pt],
      color: currentColor,
      width: currentWidth,
    };
    isDrawing = true;
  }

  function continueStroke(clientX, clientY) {
    if (!isDrawing || !currentStroke) return;
    const rect = canvas.getBoundingClientRect();
    const pt = toImageCoords(clientX, clientY, rect);
    currentStroke.points.push(pt);
    render();
  }

  function endStroke() {
    if (!isDrawing || !currentStroke) return;
    if (currentStroke.points.length >= 2) {
      strokes.push(currentStroke);
      undoStack.push({ type: 'stroke', data: currentStroke });
    }
    currentStroke = null;
    isDrawing = false;
  }

  function cancelStroke() {
    currentStroke = null;
    isDrawing = false;
    render();
  }

  function undo() {
    if (strokes.length === 0) return false;
    const last = strokes.pop();
    undoStack.push({ type: 'undo', data: last });
    render();
    return true;
  }

  function clear() {
    if (strokes.length === 0) return false;
    undoStack.push({ type: 'clear', data: [...strokes] });
    strokes.length = 0;
    render();
    return true;
  }

  function getStrokeCount() {
    return strokes.length;
  }

  function hasStrokes() {
    return strokes.length > 0;
  }

  function serialize() {
    return JSON.stringify(strokes.map(s => ({
      points: s.points,
      color: s.color,
      width: s.width,
    })));
  }

  function deserialize(json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        strokes.length = 0;
        strokes.push(...parsed.filter(s =>
          Array.isArray(s.points) && s.points.length >= 2 &&
          typeof s.color === 'string' && typeof s.width === 'number'
        ));
        undoStack.length = 0;
        render();
        return true;
      }
    } catch {
      // ignore malformed
    }
    return false;
  }

  async function bake(imageBlob, options = {}) {
    const { quality = 0.92, maxEdge = 4096 } = options;

    const image = await decodeImage(imageBlob);
    const { width: srcW, height: srcH } = imageSize(image);

    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const bakeCanvas = createCanvas(width, height);
    const bakeCtx = bakeCanvas.getContext('2d');
    if (!bakeCtx) throw new Error('Canvas 2D context недостъпен за bake.');

    bakeCtx.drawImage(image, 0, 0, width, height);
    if (typeof image.close === 'function') image.close();

    const strokeScale = scale;
    bakeCtx.lineCap = 'round';
    bakeCtx.lineJoin = 'round';

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      bakeCtx.strokeStyle = stroke.color;
      bakeCtx.lineWidth = stroke.width * strokeScale;
      bakeCtx.beginPath();
      const p0 = stroke.points[0];
      bakeCtx.moveTo(p0.x * strokeScale, p0.y * strokeScale);
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        bakeCtx.lineTo(p.x * strokeScale, p.y * strokeScale);
      }
      bakeCtx.stroke();
    }

    return canvasToBlob(bakeCanvas, 'image/jpeg', quality);
  }

  return {
    canvas,
    setDisplaySize,
    setColor,
    setWidth,
    startStroke,
    continueStroke,
    endStroke,
    cancelStroke,
    undo,
    clear,
    getStrokeCount,
    hasStrokes,
    serialize,
    deserialize,
    bake,
    colors: DRAW_COLORS,
    widths: DRAW_WIDTHS,
    currentColor: () => currentColor,
    currentWidth: () => currentWidth,
  };
}