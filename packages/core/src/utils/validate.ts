// @sdk-implemented-by: F2-primitives
import { MyImoPayValidationError } from '../errors';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/** Renders the offending value for an error message without coercing objects. */
function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}

/** Trims and rejects empty strings. */
export function assertNonEmptyString(value: unknown, field: string): string {
  const expected = `${field} must be a non-empty string`;

  if (typeof value !== 'string') {
    throw new MyImoPayValidationError(`${expected}; received ${show(value)}.`, field);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new MyImoPayValidationError(
      `${expected}; received an empty or whitespace-only string.`,
      field,
    );
  }
  return trimmed;
}

/** Only `https:` is acceptable, and only absolute URLs. */
export function assertHttpsUrl(value: unknown, field: string): string {
  const expected = `${field} must be an absolute https URL such as https://example.com/callback`;

  if (typeof value !== 'string') {
    throw new MyImoPayValidationError(`${expected}; received ${show(value)}.`, field);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new MyImoPayValidationError(
      `${expected}; received an empty or whitespace-only string.`,
      field,
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new MyImoPayValidationError(`${expected}; received ${show(value)}.`, field);
  }

  // Credentials are checked before the scheme so a password in a rejected URL is
  // never echoed back into an error message.
  if (url.username !== '' || url.password !== '') {
    throw new MyImoPayValidationError(
      `${expected}, without embedded credentials; received a URL carrying a username or password.`,
      field,
    );
  }
  if (url.protocol !== 'https:') {
    throw new MyImoPayValidationError(
      `${expected}, using the https: scheme; received ${show(value)}.`,
      field,
    );
  }
  return url.href;
}

/** Returns the upper-cased ISO-4217 code; `NGN` unless the caller says otherwise. */
export function normalizeCurrency(currency: string | undefined, field = 'currency'): string {
  if (currency === undefined) return 'NGN';

  const expected = `${field} must be a 3-letter ISO-4217 currency code such as NGN`;
  if (typeof currency !== 'string') {
    throw new MyImoPayValidationError(`${expected}; received ${show(currency)}.`, field);
  }
  const normalized = currency.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(normalized)) {
    throw new MyImoPayValidationError(`${expected}; received ${show(currency)}.`, field);
  }
  return normalized;
}

/** ISO-3166 alpha-2 for the bank directory, e.g. `NG`. */
export function normalizeCountryCode(countryCode: unknown, field = 'countryCode'): string {
  const expected = `${field} must be a 2-letter ISO-3166 alpha-2 country code such as NG`;

  if (typeof countryCode !== 'string') {
    throw new MyImoPayValidationError(`${expected}; received ${show(countryCode)}.`, field);
  }
  const normalized = countryCode.trim().toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(normalized)) {
    throw new MyImoPayValidationError(`${expected}; received ${show(countryCode)}.`, field);
  }
  return normalized;
}
