// @sdk-implemented-by: F2-primitives
import { MyImoPayValidationError } from '../errors';
import type { Numeric } from '../types/common';

/**
 * A plain decimal with an optional sign. Thousands separators are deliberately
 * rejected: the provider never sends them, so `"1,200"` is a caller bug.
 */
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Renders the offending value for an error message without coercing objects. */
function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}

/**
 * The provider returns numbers as JSON numbers *or* numeric strings, and
 * sometimes omits them entirely. Everything the SDK models as a number goes
 * through here so `Number("1,200")`, `null` and `undefined` never leak into
 * arithmetic as `NaN`.
 */
export function toNumber(value: Numeric | null | undefined, field: string): number {
  const expected = `${field} must be a finite number or a plain numeric string`;

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new MyImoPayValidationError(`${expected}; received ${show(value)}.`, field);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new MyImoPayValidationError(`${expected}; received an empty string.`, field);
    }
    if (DECIMAL_PATTERN.test(trimmed)) {
      const parsed = Number(trimmed);
      // A syntactically valid string can still overflow to Infinity.
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new MyImoPayValidationError(`${expected}; received ${show(value)}.`, field);
  }

  throw new MyImoPayValidationError(`${expected}; received ${show(value)}.`, field);
}

/** Same as `toNumber`, but tolerates absence by returning `fallback`. */
export function toNumberOr(
  value: Numeric | null | undefined,
  field: string,
  fallback: number,
): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  return toNumber(value, field);
}
