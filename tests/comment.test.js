/**
 * Unit tests for the comment helpers.
 *
 * These are pure functions (no DOM, no IndexedDB), which is what keeps them usable
 * both in the browser and in Node. Run with:  npm.cmd test
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_COMMENT_LENGTH,
  decodeXpComment,
  encodeXpComment,
  hasComment,
  normalizeComment,
  truncateComment,
  withCommentSummary,
} from '../src/utils/comment.js';

describe('normalizeComment', () => {
  it('trims and collapses whitespace but keeps the line breaks', () => {
    expect(normalizeComment('  Кутия с  документи \n\n\n до входа  ')).toBe(
      'Кутия с документи\n\nдо входа',
    );
  });

  it('drops control characters that would corrupt the DB/EXIF', () => {
    expect(normalizeComment('a\u0000b\u0007c\u001fd')).toBe('abcd');
  });

  it('returns an empty string for blank or non-string input', () => {
    expect(normalizeComment(null)).toBe('');
    expect(normalizeComment(undefined)).toBe('');
    expect(normalizeComment(42)).toBe('');
    expect(normalizeComment({ text: 'х' })).toBe('');
    expect(normalizeComment('   \n  ')).toBe('');
  });

  it('keeps cyrillic text and emoji untouched', () => {
    const text = 'Язовир „Белмекен“\nРиболов 🎣';
    expect(normalizeComment(text)).toBe(text);
  });

  it('clamps to the limit without splitting an emoji in half', () => {
    const clamped = normalizeComment('🎈'.repeat(MAX_COMMENT_LENGTH + 10));
    expect([...clamped]).toHaveLength(MAX_COMMENT_LENGTH);
    expect(clamped).toBe('🎈'.repeat(MAX_COMMENT_LENGTH));
  });

  it('accepts a custom limit', () => {
    expect(normalizeComment('абвгде', 3)).toBe('абв');
  });
});

describe('hasComment', () => {
  it('is false for empty/whitespace input', () => {
    expect(hasComment('')).toBe(false);
    expect(hasComment('  \n ')).toBe(false);
    expect(hasComment(null)).toBe(false);
  });

  it('is true once there is real text', () => {
    expect(hasComment('  бележка ')).toBe(true);
  });
});

describe('truncateComment', () => {
  it('renders a single-line preview', () => {
    expect(truncateComment('първи ред\nвтори ред')).toBe('първи ред втори ред');
  });

  it('appends an ellipsis and stays within the limit', () => {
    const preview = truncateComment('я'.repeat(100), 10);
    expect([...preview]).toHaveLength(10);
    expect(preview).toBe(`${'я'.repeat(9)}…`);
  });

  it('returns an empty string when there is nothing to show', () => {
    expect(truncateComment('   ')).toBe('');
    expect(truncateComment(undefined)).toBe('');
  });
});

// EXIF tag 40092 (XPComment) is a NUL terminated UTF-16LE byte array - the only
// encoding that keeps Cyrillic readable in Windows Explorer / classic EXIF viewers.
describe('XPComment encoding', () => {
  it('round-trips cyrillic text', () => {
    const text = 'Кутията с документи до входа';
    expect(decodeXpComment(encodeXpComment(text))).toBe(text);
  });

  it('round-trips emoji (surrogate pairs)', () => {
    const text = 'Снимка 🎈📍 с линк';
    expect(decodeXpComment(encodeXpComment(text))).toBe(text);
  });

  it('is little-endian and NUL terminated', () => {
    // 'A' = U+0041, 'Я' = U+042F
    expect(encodeXpComment('A').slice(0, 2)).toEqual([0x41, 0x00]);
    expect(encodeXpComment('Я').slice(0, 2)).toEqual([0x2f, 0x04]);
    expect(encodeXpComment('ok').slice(-2)).toEqual([0, 0]);
    expect(encodeXpComment('ok')).toHaveLength(2 * 2 + 2);
  });

  it('normalises before encoding', () => {
    expect(decodeXpComment(encodeXpComment('  интервал  '))).toBe('интервал');
  });

  it('decodes defensively', () => {
    expect(decodeXpComment([])).toBe('');
    expect(decodeXpComment(null)).toBe('');
    expect(decodeXpComment([0x41])).toBe('');
    expect(decodeXpComment([0x41, 0x00, 0x42, 0x00, 0x00, 0x00])).toBe('AB');
    // A zero *unit* (0x0000) terminates the string, everything after it is ignored.
    expect(decodeXpComment([0x41, 0x00, 0x00, 0x00, 0x42, 0x00])).toBe('A');
  });
});

describe('withCommentSummary', () => {
  it('appends the comment as a single quoted line', () => {
    expect(withCommentSummary('41.1, 24.7', 'първи\nвтори')).toBe('41.1, 24.7 | „първи втори“');
  });

  it('leaves the summary untouched when there is no comment', () => {
    expect(withCommentSummary('41.1, 24.7', '   ')).toBe('41.1, 24.7');
    expect(withCommentSummary('41.1, 24.7', null)).toBe('41.1, 24.7');
  });

  it('works without a summary', () => {
    expect(withCommentSummary('', 'бележка')).toBe('„бележка“');
  });
});
