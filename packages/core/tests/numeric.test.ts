// @sdk-implemented-by: F2-primitives
import { describe, expect, test } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import type { Numeric } from '@core/types/common';
import { toNumber, toNumberOr } from '@core/utils/numeric';

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

describe('toNumber', () => {
  test('passes finite numbers through unchanged', () => {
    expect(toNumber(0, 'amount')).toBe(0);
    expect(toNumber(-12.5, 'amount')).toBe(-12.5);
    expect(toNumber(1500.1, 'amount')).toBe(1500.1);
  });

  test('parses plain numeric strings', () => {
    expect(toNumber('1500.10', 'amount')).toBe(1500.1);
    expect(toNumber('0', 'amount')).toBe(0);
    expect(toNumber('-3', 'amount')).toBe(-3);
    expect(toNumber('+3', 'amount')).toBe(3);
    expect(toNumber('.5', 'amount')).toBe(0.5);
  });

  test('tolerates surrounding whitespace', () => {
    expect(toNumber(' 42 ', 'amount')).toBe(42);
    expect(toNumber('\n42\t', 'amount')).toBe(42);
  });

  test('rejects thousands separators', () => {
    for (const value of ['1,200', '1 200', '1_200']) {
      expect(() => toNumber(value, 'amount')).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects NaN and infinities', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => toNumber(value, 'amount')).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects non-numeric strings', () => {
    for (const value of ['', '   ', 'NaN', 'Infinity', 'abc', '12abc', '0x10', '1.2.3']) {
      expect(() => toNumber(value, 'amount')).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects a syntactically valid string that overflows to Infinity', () => {
    expect(() => toNumber('9'.repeat(400), 'amount')).toThrow(MyImoPayValidationError);
  });

  test('rejects absence and booleans', () => {
    expect(() => toNumber(null, 'amount')).toThrow(MyImoPayValidationError);
    expect(() => toNumber(undefined, 'amount')).toThrow(MyImoPayValidationError);
    expect(() => toNumber(true as unknown as Numeric, 'amount')).toThrow(MyImoPayValidationError);
    expect(() => toNumber(false as unknown as Numeric, 'amount')).toThrow(MyImoPayValidationError);
  });

  test('names the field in the message', () => {
    const error = caught(() => toNumber('abc', 'data.amount_paid'));
    expect(error.field).toBe('data.amount_paid');
    expect(error.message).toContain('data.amount_paid');

    const empty = caught(() => toNumber('', 'data.amount_paid'));
    expect(empty.message).toContain('empty string');
  });

  test('echoes the offending value', () => {
    expect(caught(() => toNumber('abc', 'amount')).message).toContain('"abc"');
    expect(caught(() => toNumber(Number.NaN, 'amount')).message).toContain('NaN');
  });
});

describe('toNumberOr', () => {
  test('returns the fallback for null, undefined and blank strings', () => {
    expect(toNumberOr(null, 'amount', 7)).toBe(7);
    expect(toNumberOr(undefined, 'amount', 7)).toBe(7);
    expect(toNumberOr('', 'amount', 7)).toBe(7);
    expect(toNumberOr('   ', 'amount', 7)).toBe(7);
  });

  test('returns real values, including zero', () => {
    expect(toNumberOr(0, 'amount', 7)).toBe(0);
    expect(toNumberOr('12', 'amount', 7)).toBe(12);
    expect(toNumberOr(3.5, 'amount', 7)).toBe(3.5);
  });

  test('still rejects an unusable value', () => {
    expect(() => toNumberOr('abc', 'amount', 0)).toThrow(MyImoPayValidationError);
    expect(() => toNumberOr(Number.NaN, 'amount', 0)).toThrow(MyImoPayValidationError);
  });
});
