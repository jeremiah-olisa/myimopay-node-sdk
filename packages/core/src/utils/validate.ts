import { MyImoPayValidationError } from '../errors';

/** Trims and rejects empty strings. */
export function assertNonEmptyString(value: unknown, field: string): string {
  void value;
  void field;
  throw new MyImoPayValidationError('not implemented: assertNonEmptyString', field);
}

/** Only `https:` is acceptable, and only absolute URLs. */
export function assertHttpsUrl(value: unknown, field: string): string {
  void value;
  void field;
  throw new MyImoPayValidationError('not implemented: assertHttpsUrl', field);
}

/** Returns the upper-cased ISO-4217 code; `NGN` unless the caller says otherwise. */
export function normalizeCurrency(currency: string | undefined, field = 'currency'): string {
  void currency;
  void field;
  throw new Error('not implemented: normalizeCurrency');
}

/** ISO-3166 alpha-2 for the bank directory, e.g. `NG`. */
export function normalizeCountryCode(countryCode: unknown, field = 'countryCode'): string {
  void countryCode;
  void field;
  throw new MyImoPayValidationError('not implemented: normalizeCountryCode', field);
}
