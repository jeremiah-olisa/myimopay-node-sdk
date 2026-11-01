// @sdk-implemented-by: F2-primitives
import { describe, expect, test } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import {
  assertHttpsUrl,
  assertNonEmptyString,
  normalizeCountryCode,
  normalizeCurrency,
} from '@core/utils/validate';

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

describe('assertNonEmptyString', () => {
  test('returns the trimmed value', () => {
    expect(assertNonEmptyString('  hello  ', 'field')).toBe('hello');
    expect(assertNonEmptyString('a', 'field')).toBe('a');
  });

  test('rejects empty and whitespace-only strings', () => {
    for (const value of ['', '   ', '\n\t']) {
      const error = caught(() => assertNonEmptyString(value, 'customer.fullName'));
      expect(error.field).toBe('customer.fullName');
      expect(error.message).toContain('customer.fullName');
    }
  });

  test('rejects non-strings', () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(() => assertNonEmptyString(value, 'customer.fullName')).toThrow(
        MyImoPayValidationError,
      );
    }
    expect(caught(() => assertNonEmptyString(42, 'customer.fullName')).message).toContain('42');
  });
});

describe('assertHttpsUrl', () => {
  test('returns the normalised href', () => {
    expect(assertHttpsUrl('https://example.com', 'callbackUrl')).toBe('https://example.com/');
    expect(assertHttpsUrl('https://example.com/pay?ref=abc', 'callbackUrl')).toBe(
      'https://example.com/pay?ref=abc',
    );
    expect(assertHttpsUrl('  https://example.com/cb  ', 'callbackUrl')).toBe(
      'https://example.com/cb',
    );
    expect(assertHttpsUrl('https://example.com:8443/cb', 'callbackUrl')).toBe(
      'https://example.com:8443/cb',
    );
  });

  test('rejects absolute non-https schemes', () => {
    for (const value of [
      'http://example.com/cb',
      'ftp://example.com/cb',
      'javascript:alert(1)',
      'data:text/plain,hello',
    ]) {
      const error = caught(() => assertHttpsUrl(value, 'callbackUrl'));
      expect(error.message).toContain('https');
      expect(error.field).toBe('callbackUrl');
    }
  });

  test('rejects relative paths and bare hosts', () => {
    for (const value of ['/cb', 'cb', 'example.com/cb', '//example.com/cb', '']) {
      expect(() => assertHttpsUrl(value, 'callbackUrl')).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects embedded credentials without echoing them', () => {
    const error = caught(() => assertHttpsUrl('https://user:s3cret@example.com/cb', 'callbackUrl'));
    expect(error.message).toContain('credentials');
    expect(error.message).not.toContain('s3cret');
    expect(error.message).not.toContain('user:');

    // The scheme is checked after the credentials, so an http URL cannot leak a password either.
    const insecure = caught(() =>
      assertHttpsUrl('http://user:s3cret@example.com/cb', 'callbackUrl'),
    );
    expect(insecure.message).toContain('credentials');
    expect(insecure.message).not.toContain('s3cret');
  });

  test('rejects non-strings', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(() => assertHttpsUrl(value, 'callbackUrl')).toThrow(MyImoPayValidationError);
    }
  });
});

describe('normalizeCurrency', () => {
  test('defaults to NGN when undefined', () => {
    expect(normalizeCurrency(undefined)).toBe('NGN');
  });

  test('upper-cases and trims', () => {
    expect(normalizeCurrency('ngn')).toBe('NGN');
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency(' eur ')).toBe('EUR');
  });

  test('rejects anything that is not three letters', () => {
    for (const value of ['', 'NG', 'NGNN', '12N', 'N G', '₦₦₦']) {
      const error = caught(() => normalizeCurrency(value));
      expect(error.field).toBe('currency');
      expect(error.message).toContain('ISO-4217');
    }
  });

  test('names a custom field', () => {
    expect(caught(() => normalizeCurrency('NG', 'input.currency')).field).toBe('input.currency');
  });
});

describe('normalizeCountryCode', () => {
  test('upper-cases a two-letter code', () => {
    expect(normalizeCountryCode('ng')).toBe('NG');
    expect(normalizeCountryCode('NG')).toBe('NG');
    expect(normalizeCountryCode(' gh ')).toBe('GH');
  });

  test('requires a value, unlike the currency default', () => {
    for (const value of [undefined, null, '']) {
      expect(() => normalizeCountryCode(value)).toThrow(MyImoPayValidationError);
    }
  });

  test('rejects anything that is not two letters', () => {
    for (const value of ['N', 'NGA', '12', 'N1', 'N G']) {
      const error = caught(() => normalizeCountryCode(value));
      expect(error.field).toBe('countryCode');
      expect(error.message).toContain('ISO-3166');
    }
  });

  test('names a custom field', () => {
    expect(caught(() => normalizeCountryCode('NGA', 'country')).field).toBe('country');
  });
});
