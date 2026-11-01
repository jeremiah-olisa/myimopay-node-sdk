// @sdk-implemented-by: F2-primitives
import { describe, expect, it, test } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import {
  assertReference,
  createReference,
  MAX_REFERENCE_LENGTH,
  REFERENCE_PATTERN,
  sanitizeReference,
} from '@core/utils/reference';

/** Runs `fn` and returns the validation error it must throw. */
function caught(fn: () => void): MyImoPayValidationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof MyImoPayValidationError) return error;
    throw error;
  }
  throw new Error('expected fn to throw MyImoPayValidationError');
}

/** A deterministic random source: always the same roll. */
function constant(value: number): () => number {
  return () => value;
}

describe('assertReference', () => {
  test('exposes the frozen provider limits', () => {
    expect(MAX_REFERENCE_LENGTH).toBe(20);
    expect(REFERENCE_PATTERN.test('a-1_.')).toBe(true);
    expect(REFERENCE_PATTERN.test('a b')).toBe(false);
  });

  test('accepts references at the length limits', () => {
    expect(assertReference('inv-1042')).toBe('inv-1042');
    expect(assertReference('a')).toBe('a');
    expect(assertReference('A_b.c-d')).toBe('A_b.c-d');
    expect(assertReference('x'.repeat(MAX_REFERENCE_LENGTH))).toBe('x'.repeat(20));
  });

  test('rejects an empty reference', () => {
    expect(caught(() => assertReference('')).message).toContain('1 to 20');
  });

  test('rejects anything longer than 20 characters', () => {
    const error = caught(() => assertReference('x'.repeat(21)));
    expect(error.message).toContain('1 to 20');
    expect(error.message).toContain('[A-Za-z0-9._-]');
  });

  test('rejects characters outside [A-Za-z0-9._-]', () => {
    for (const value of ['abc/def', 'a b', 'inv#1', 'naïve', 'ref\n', `${'x'.repeat(19)} `]) {
      const error = caught(() => assertReference(value));
      expect(error.message).toContain('[A-Za-z0-9._-]');
    }
  });

  test('rejects a reference made only of separators', () => {
    for (const value of ['-', '...', '___', '-._-']) {
      expect(() => assertReference(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects non-strings', () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(() => assertReference(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('names the field it was given', () => {
    const error = caught(() => assertReference('', 'input.reference'));
    expect(error.field).toBe('input.reference');
    expect(error.message).toContain('input.reference');
  });
});

describe('createReference', () => {
  test('produces a 16-character random reference with no seed', () => {
    const reference = createReference(undefined, constant(0));
    expect(reference).toBe('0'.repeat(16));
    expect(reference.length).toBeLessThanOrEqual(MAX_REFERENCE_LENGTH);
    expect(REFERENCE_PATTERN.test(reference)).toBe(true);
  });

  test('keeps a readable seed and appends a 4-character suffix', () => {
    expect(createReference('inv-1042', constant(0))).toBe('inv-1042-0000');
    expect(createReference('inv-1042', constant(0.5))).toBe('inv-1042-iiii');
    expect(createReference('inv-1042', constant(0.999999))).toBe('inv-1042-zzzz');
  });

  test('is deterministic for a seed plus a supplied random source', () => {
    expect(createReference('order-7', constant(0.1))).toBe(
      createReference('order-7', constant(0.1)),
    );
    expect(createReference('order-7', constant(0.1))).toBe('order-7-3333');
  });

  test('truncates a seed that is too long and still fits 20 characters', () => {
    const reference = createReference('x'.repeat(50), constant(0));
    expect(reference).toBe(`${'x'.repeat(15)}-0000`);
    expect(reference.length).toBe(20);
  });

  test('replaces disallowed runs with a single dash', () => {
    expect(createReference('order/2024/0001', constant(0))).toBe('order-2024-0001-0000');
    expect(createReference('inv #42 / paid', constant(0))).toBe('inv-42-paid-0000');
  });

  test('trims leading and trailing separators from the seed', () => {
    expect(createReference('__inv-42__', constant(0))).toBe('inv-42-0000');
    expect(createReference('  inv 42  ', constant(0))).toBe('inv-42-0000');
  });

  test('falls back to a random reference for a seed with nothing usable left', () => {
    for (const seed of ['', '   ', '///', '---', '...']) {
      const reference = createReference(seed, constant(0));
      expect(reference).toBe('0'.repeat(16));
    }
  });

  test('never ends a truncated seed with a separator', () => {
    const reference = createReference(`${'a'.repeat(14)} b`, constant(0));
    expect(reference).toBe(`${'a'.repeat(14)}-0000`);
  });

  test('always validates, at the length limit, for awkward seeds', () => {
    const seeds = [
      undefined,
      '',
      'x'.repeat(200),
      `${'y'.repeat(15)} tail`,
      'order/2024/0001',
      'a.b_c-d',
      '   padded   ',
      'ref with emoji 🚀 and more',
    ];
    for (const seed of seeds) {
      const reference = createReference(seed, constant(0.42));
      expect(reference.length).toBeGreaterThan(0);
      expect(reference.length).toBeLessThanOrEqual(MAX_REFERENCE_LENGTH);
      expect(REFERENCE_PATTERN.test(reference)).toBe(true);
      expect(assertReference(reference)).toBe(reference);
    }
  });

  test('clamps a random source outside [0, 1)', () => {
    expect(createReference('seed', constant(1))).toBe('seed-zzzz');
    expect(createReference('seed', constant(-1))).toBe('seed-0000');
    expect(createReference('seed', constant(Number.NaN))).toBe('seed-0000');
  });

  test('uses lowercase hex-ish characters for the suffix', () => {
    const suffix = createReference('seed', constant(0.75)).slice('seed-'.length);
    expect(suffix).toBe('rrrr');
    expect(suffix).toMatch(/^[0-9a-z]{4}$/);
  });
});

describe('sanitizeReference', () => {
  it('coerces an id with slashes into a provider-valid reference', () => {
    expect(sanitizeReference('INV/2026/0001')).toBe('INV-2026-0001');
    expect(sanitizeReference('  order #42  ')).toBe('order-42');
  });

  it('keeps timestamps and UUID-shaped ids intact up to the limit', () => {
    expect(sanitizeReference('1723456789012')).toBe('1723456789012');
    expect(sanitizeReference('3f0c1e42-9a1b-4c7d-8e2f-0123456789ab')).toBe('3f0c1e42-9a1b-4c7d-8');
  });

  it('truncates to 20 characters without leaving a trailing separator', () => {
    const result = sanitizeReference('abcdefghij/klmnopqrst/uvwxyz');
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toMatch(REFERENCE_PATTERN);
    expect(result.endsWith('-')).toBe(false);
  });

  it('is deterministic for the same input', () => {
    expect(sanitizeReference('INV 2026/1')).toBe(sanitizeReference('INV 2026/1'));
  });

  it('falls back to a random reference when nothing usable remains', () => {
    const result = sanitizeReference('///', () => 0.5);
    expect(result).toHaveLength(MAX_REFERENCE_LENGTH);
    expect(result).toMatch(REFERENCE_PATTERN);
  });
});
