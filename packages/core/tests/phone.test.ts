// @sdk-implemented-by: F2-primitives
import { describe, expect, test } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import { assertPhone, normalizeNigerianPhone } from '@core/utils/phone';

const E164 = '+2348031234567';

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

describe('normalizeNigerianPhone', () => {
  test('normalises every accepted national and international form', () => {
    expect(normalizeNigerianPhone('08031234567')).toBe(E164);
    expect(normalizeNigerianPhone('8031234567')).toBe(E164);
    expect(normalizeNigerianPhone('2348031234567')).toBe(E164);
    expect(normalizeNigerianPhone('+2348031234567')).toBe(E164);
  });

  test('strips spaces, dashes, dots and brackets', () => {
    expect(normalizeNigerianPhone('0803 123 4567')).toBe(E164);
    expect(normalizeNigerianPhone('0803-123-4567')).toBe(E164);
    expect(normalizeNigerianPhone('0803.123.4567')).toBe(E164);
    expect(normalizeNigerianPhone('(0803) 123 4567')).toBe(E164);
    expect(normalizeNigerianPhone('+234 803 123 4567')).toBe(E164);
    expect(normalizeNigerianPhone(' (+234) 803-123.4567 ')).toBe(E164);
  });

  test('is idempotent on an already-normalised number', () => {
    expect(normalizeNigerianPhone(normalizeNigerianPhone('08031234567'))).toBe(E164);
  });

  test('rejects wrong lengths', () => {
    for (const value of [
      '',
      '1',
      '0803123456', // 10 digits starting with 0
      '080312345678', // 12
      '0803123456789', // 13, but not starting with 234
      '23480312345', // 11, 234 prefix but incomplete
      '234803123456', // 12
      '23480312345678', // 14
      '803123456', // 9
      '80312345678', // 11, no leading zero
    ]) {
      expect(() => normalizeNigerianPhone(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects landline-shaped and foreign national numbers', () => {
    for (const value of ['0123456789', '5551234567', '2340803123456', '1234567890']) {
      expect(() => normalizeNigerianPhone(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects non-digits and other country codes', () => {
    for (const value of [
      '0803123456a',
      '+23480312345x',
      '+1 555 010 9999',
      '+447911123456',
      '4915112345678',
      '+234-803-123-4567 ext 2',
      '++2348031234567',
    ]) {
      expect(() => normalizeNigerianPhone(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('reports an accepted example in the message', () => {
    const error = caught(() => normalizeNigerianPhone('123'));
    expect(error.message).toContain('+2348031234567');
    expect(error.message).toContain('08031234567');
    expect(error.message).toContain('"123"');
  });
});

describe('assertPhone', () => {
  test('returns the normalised number', () => {
    expect(assertPhone('08031234567')).toBe(E164);
    expect(assertPhone('8031234567')).toBe(E164);
    expect(assertPhone('+2348031234567')).toBe(E164);
  });

  test('defaults the field to customer.mobile', () => {
    const error = caught(() => assertPhone('nope'));
    expect(error.field).toBe('customer.mobile');
    expect(error.message).toContain('customer.mobile');
    expect(error.message).toContain('+2348031234567');
  });

  test('honours a custom field name', () => {
    const error = caught(() => assertPhone('0803123456', 'subaccount.phone'));
    expect(error.field).toBe('subaccount.phone');
    expect(error.message).toContain('subaccount.phone');
  });

  test('rejects non-strings without leaking a TypeError', () => {
    for (const value of [null, undefined, 8031234567, {}, [], true]) {
      const error = caught(() => assertPhone(value));
      expect(error.field).toBe('customer.mobile');
    }
    expect(caught(() => assertPhone(8031234567)).message).toContain('8031234567');
  });
});
