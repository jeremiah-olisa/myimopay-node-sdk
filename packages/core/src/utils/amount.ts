// @sdk-implemented-by: F2-primitives
import { MyImoPayValidationError } from '../errors';
import type { Amount } from '../types/common';

/** Provider ceiling for a single payment, in major units. */
const MAX_AMOUNT = 1e9;

/**
 * Largest drift tolerated between an amount and its 2dp form. Wide enough for
 * float noise (`0.1 + 0.2`), far too narrow for a real third decimal.
 */
const AMOUNT_TOLERANCE = Number.EPSILON * 100;

const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;

/** Renders the offending value for an error message without coercing objects. */
function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}

/** Throws `MyImoPayValidationError` unless `amount` is a usable payment amount. */
export function assertAmount(amount: unknown, field = 'amount'): asserts amount is Amount {
  const expected =
    `${field} must be a finite number of major units, greater than 0, with at most 2 ` +
    `decimal places and no more than ${MAX_AMOUNT}`;

  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new MyImoPayValidationError(`${expected}; received ${show(amount)}.`, field);
  }
  if (amount <= 0 || amount > MAX_AMOUNT) {
    throw new MyImoPayValidationError(`${expected}; received ${show(amount)}.`, field);
  }
  if (Math.abs(amount - Math.round(amount * 100) / 100) > AMOUNT_TOLERANCE) {
    throw new MyImoPayValidationError(`${expected}; received ${show(amount)}.`, field);
  }
}

/**
 * Validates a caller amount and serialises it as fixed-point for the wire.
 *
 * Provider rule: a positive amount in major units, at most two decimals.
 * The SDK sends a fixed-point string so no float rounding can creep in
 * (`1500.1` → `"1500.10"`).
 */
export function toApiAmount(amount: Amount, field = 'amount'): string {
  assertAmount(amount, field);
  return amount.toFixed(2);
}

/** Human formatting for UI (`₦1,500.10`). Currency symbol falls back to the code. */
export function formatMoney(amount: Amount, currency = 'NGN', locale = 'en-NG'): string {
  if (CURRENCY_CODE_PATTERN.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
    } catch {
      // An unknown locale must never break a UI over a label; fall through.
    }
  }
  return `${currency} ${formatDecimal(amount, locale)}`;
}

/** Grouped 2dp number for the fallback path, which cannot rely on `Intl`. */
function formatDecimal(amount: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}
