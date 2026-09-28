/**
 * Comment helpers.
 *
 * The comment is the third element of a gallery record, next to the photo and the
 * rasterised mini-map. All three live in the *same* IndexedDB record, so deleting a
 * photo deletes its map and its comment with it - there is no separate table that
 * could drift apart or leave orphans behind.
 *
 * Pure functions only - safe to unit test in Node.
 */

/** Hard limit for one comment (mirrors `maxlength="500"` in index.html). */
export const MAX_COMMENT_LENGTH = 500;

/** Characters rendered on a gallery tile before the ellipsis kicks in. */
export const TILE_COMMENT_LENGTH = 70;

/** C0/C1 controls (except \n) would end up as garbage in the DB and in EXIF. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Normalise raw textarea input: drop control characters, collapse runs of spaces,
 * keep at most one blank line, trim and clamp to `max` characters.
 *
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string} '' when there is nothing meaningful to store
 */
export function normalizeComment(text, max = MAX_COMMENT_LENGTH) {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(CONTROL_CHARS, '')
    .replace(/[^\S\n]+/g, ' ') // collapse spaces/tabs, keep the newlines
    .replace(/[^\S\n]*\n[^\S\n]*/g, '\n') // drop the padding around each newline
    .replace(/\n{3,}/g, '\n\n') // at most one empty line
    .trim();

  if (cleaned.length <= max) return cleaned;
  // Clamp by code points so an emoji is never cut in half.
  return [...cleaned].slice(0, max).join('').trimEnd();
}

/** @returns {boolean} true when there is a comment worth storing/rendering. */
export function hasComment(text) {
  return normalizeComment(text).length > 0;
}

/**
 * Single-line preview for the gallery tile (newlines become spaces).
 *
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function truncateComment(text, max = TILE_COMMENT_LENGTH) {
  const value = normalizeComment(text).replace(/\s*\n+\s*/g, ' ');
  if (!value) return '';
  const points = [...value];
  return points.length <= max ? value : `${points.slice(0, Math.max(1, max - 1)).join('')}…`;
}

/**
 * XPComment (EXIF tag 40092, type BYTE, 0th IFD) is a NUL terminated UTF-16LE byte
 * array - the only encoding that keeps Cyrillic readable in Windows Explorer and in
 * classic EXIF viewers. `UserComment` (37510) is typed ASCII by piexif and would
 * mangle anything above U+007F, so we deliberately do not use it.
 *
 * @param {unknown} text
 * @returns {number[]} bytes, always NUL terminated
 */
export function encodeXpComment(text) {
  const value = normalizeComment(text);
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    bytes.push(unit & 0xff, (unit >> 8) & 0xff);
  }
  bytes.push(0, 0);
  return bytes;
}

/**
 * Inverse of {@link encodeXpComment}; tolerates missing/half NUL terminators and
 * anything a foreign writer may have put into the tag.
 *
 * @param {unknown} bytes
 * @returns {string}
 */
export function decodeXpComment(bytes) {
  if (!Array.isArray(bytes) || bytes.length === 0) return '';
  const units = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const unit = (Number(bytes[index]) & 0xff) | ((Number(bytes[index + 1]) & 0xff) << 8);
    if (unit === 0) break;
    units.push(unit);
  }
  return normalizeComment(String.fromCharCode(...units));
}

/**
 * Appends the comment to a plain-text summary (clipboard / share sheet).
 *
 * @param {string} summary
 * @param {unknown} text
 * @returns {string}
 */
export function withCommentSummary(summary, text) {
  const comment = normalizeComment(text);
  if (!comment) return summary;
  const oneLine = comment.replace(/\s*\n+\s*/g, ' ');
  return summary ? `${summary} | „${oneLine}“` : `„${oneLine}“`;
}
