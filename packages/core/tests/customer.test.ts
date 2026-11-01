import { describe, expect, it } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import {
  deriveEmailFromPhone,
  normalizeCustomerEmail,
  sanitizeCustomerName,
} from '@core/utils/customer';

describe('sanitizeCustomerName', () => {
  it('strips punctuation, collapses spaces and keeps readable words', () => {
    expect(sanitizeCustomerName("O'Brien-Okafor  Chinedu!")).toBe('OBrien Okafor Chinedu');
    expect(sanitizeCustomerName('OLIVE HOTEL & SUITES')).toBe('OLIVE HOTEL SUITES');
    expect(sanitizeCustomerName('GRANDHIT HOTELS/SUITES')).toBe('GRANDHIT HOTELS SUITES');
  });

  it('folds accents to ASCII instead of dropping the name', () => {
    expect(sanitizeCustomerName('Ádáirọ̀ Ọlá')).toBe('Adairo Ola');
  });

  it('merges a lone one-letter word into its neighbour', () => {
    expect(sanitizeCustomerName('H careplus pharmacy')).toBe('Hcareplus pharmacy');
    expect(sanitizeCustomerName('Grace C Amanda')).toBe('Grace CAmanda');
    expect(sanitizeCustomerName('Uju Plaza Phase x')).toBe('Uju Plaza Phasex');
  });

  it('pads a single-word name so the provider accepts two words', () => {
    expect(sanitizeCustomerName('Techcourt')).toBe('Techcourt Customer');
    expect(sanitizeCustomerName('SYNLAB')).toBe('SYNLAB Customer');
  });

  it('falls back when nothing usable survives', () => {
    expect(sanitizeCustomerName('')).toBe('Valued Customer');
    expect(sanitizeCustomerName('   ')).toBe('Valued Customer');
    expect(sanitizeCustomerName('!!! ???')).toBe('Valued Customer');
    expect(sanitizeCustomerName('😀😀')).toBe('Valued Customer');
    expect(sanitizeCustomerName(null)).toBe('Valued Customer');
    expect(sanitizeCustomerName(undefined)).toBe('Valued Customer');
  });

  it('honours a custom fallback and a length ceiling', () => {
    expect(sanitizeCustomerName('', { fallback: 'Walk-in Customer' })).toBe('Walk-in Customer');
    expect(sanitizeCustomerName('A'.repeat(40), { maxLength: 10 })).toHaveLength(10);
  });

  it('is idempotent', () => {
    const once = sanitizeCustomerName('H careplus pharmacy!');
    expect(sanitizeCustomerName(once)).toBe(once);
  });
});

describe('normalizeCustomerEmail', () => {
  it('treats absent and blank values as no email', () => {
    expect(normalizeCustomerEmail(undefined)).toBeUndefined();
    expect(normalizeCustomerEmail(null)).toBeUndefined();
    expect(normalizeCustomerEmail('')).toBeUndefined();
    expect(normalizeCustomerEmail('   ')).toBeUndefined();
  });

  it('trims and accepts a normal address', () => {
    expect(normalizeCustomerEmail('  ada@example.com ')).toBe('ada@example.com');
    expect(normalizeCustomerEmail('ada+tag@sub.example.co.uk')).toBe('ada+tag@sub.example.co.uk');
  });

  it('rejects a malformed address before the provider sees it', () => {
    expect(() => normalizeCustomerEmail('not-an-email')).toThrow(MyImoPayValidationError);
    expect(() => normalizeCustomerEmail('ada@localhost')).toThrow(MyImoPayValidationError);
    expect(() => normalizeCustomerEmail('ada @example.com')).toThrow(MyImoPayValidationError);
    expect(() => normalizeCustomerEmail(`${'a'.repeat(250)}@example.com`)).toThrow(
      MyImoPayValidationError,
    );
  });

  it('rejects a non-string value', () => {
    expect(() => normalizeCustomerEmail(42)).toThrow(MyImoPayValidationError);
  });
});

describe('deriveEmailFromPhone', () => {
  it('derives a national-format address from an E.164 number', () => {
    expect(deriveEmailFromPhone('+2348031234567', 'payments.example.com')).toBe(
      '08031234567@payments.example.com',
    );
  });

  it('keeps a locally formatted number as-is', () => {
    expect(deriveEmailFromPhone('08031234567', 'example.ng')).toBe('08031234567@example.ng');
  });

  it('rejects a phone with no digits and a malformed domain', () => {
    expect(() => deriveEmailFromPhone('   ', 'example.com')).toThrow(MyImoPayValidationError);
    expect(() => deriveEmailFromPhone('08031234567', 'not a domain')).toThrow(
      MyImoPayValidationError,
    );
  });
});
