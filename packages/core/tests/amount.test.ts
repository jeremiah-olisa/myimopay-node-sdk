// @sdk-implemented-by: F2-primitives
import { describe, expect, test } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import { assertAmount, formatMoney, toApiAmount } from '@core/utils/amount';

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

describe('assertAmount', () => {
  test('accepts positive amounts with at most 2 decimals', () => {
    for (const value of [0.01, 0.5, 1, 1.05, 1500.1, 1500.1, 999999999.99, 1e9]) {
      expect(() => assertAmount(value)).not.toThrow();
    }
  });

  test('accepts float noise from ordinary arithmetic', () => {
    expect(() => assertAmount(0.1 + 0.2)).not.toThrow();
    expect(() => assertAmount(1.005 + 0.995 - 2 + 1)).not.toThrow();
  });

  test('rejects zero', () => {
    const error = caught(() => assertAmount(0));
    expect(error.field).toBe('amount');
    expect(error.message).toContain('greater than 0');
    expect(error.message).toContain('received 0');
  });

  test('rejects negative amounts', () => {
    const error = caught(() => assertAmount(-1));
    expect(error.message).toContain('received -1');
  });

  test('rejects NaN and infinities', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => assertAmount(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects numeric strings, because the public API is typed', () => {
    const error = caught(() => assertAmount('1500.00'));
    expect(error.message).toContain('finite number');
    expect(error.message).toContain('"1500.00"');
    expect(error.field).toBe('amount');
  });

  test('rejects null, undefined, booleans and objects', () => {
    for (const value of [null, undefined, true, {}, [], () => 1]) {
      expect(() => assertAmount(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects a third decimal place', () => {
    for (const value of [0.001, 1.234, 10.005, 2.999]) {
      expect(() => assertAmount(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('names the field it was given', () => {
    const error = caught(() => assertAmount(-1, 'input.amount'));
    expect(error.field).toBe('input.amount');
    expect(error.message).toContain('input.amount');
  });

  test('accepts exactly 1e9 and rejects anything above it', () => {
    expect(() => assertAmount(1_000_000_000)).not.toThrow();
    const error = caught(() => assertAmount(1_000_000_001));
    expect(error.message).toContain('1000000000');
    expect(() => assertAmount(1e10)).toThrow(MyImoPayValidationError);
  });
});

describe('toApiAmount', () => {
  test('serialises fixed-point with exactly two decimals', () => {
    expect(toApiAmount(1500.1)).toBe('1500.10');
    expect(toApiAmount(1500)).toBe('1500.00');
    expect(toApiAmount(0.5)).toBe('0.50');
    expect(toApiAmount(0.01)).toBe('0.01');
    expect(toApiAmount(1_000_000)).toBe('1000000.00');
  });

  test('normalises float noise instead of leaking it onto the wire', () => {
    expect(toApiAmount(0.1 + 0.2)).toBe('0.30');
    expect(toApiAmount(0.1 + 0.2 + 0.3)).toBe('0.60');
  });

  test('fails validation on sub-cent values instead of sending "0.00"', () => {
    const error = caught(() => toApiAmount(1e-7));
    expect(error.message).toContain('1e-7');
    expect(() => toApiAmount(0.004)).toThrow(MyImoPayValidationError);
  });

  test('propagates the field name to the validation error', () => {
    const error = caught(() => toApiAmount(Number.NaN, 'input.amount'));
    expect(error.field).toBe('input.amount');
    expect(error.message).toContain('input.amount');
  });
});

describe('formatMoney', () => {
  test('formats NGN for the default locale', () => {
    const formatted = formatMoney(1234.5);
    expect(formatted).toContain('1,234.50');
    expect(formatted).toContain('₦');
  });

  test('formats other currencies passed by the caller', () => {
    expect(formatMoney(99.99, 'USD', 'en-US')).toBe('$99.99');
  });

  test('falls back to a "<CODE> 1,234.50" shape for an invalid currency code', () => {
    expect(formatMoney(1234.5, 'NGNN')).toBe('NGNN 1,234.50');
    expect(formatMoney(1234.5, '')).toBe(' 1,234.50');
  });

  test('never throws, even for an unusable locale', () => {
    expect(formatMoney(1234.5, 'NGN', '!!')).toBe('NGN 1234.50');
    expect(formatMoney(1234.5, 'NGNN', '!!')).toBe('NGNN 1234.50');
  });
});
