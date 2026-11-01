import type { Numeric } from '../types/common';

/**
 * The provider returns numbers as JSON numbers *or* numeric strings, and
 * sometimes omits them entirely. Everything the SDK models as a number goes
 * through here so `Number("1,200")`, `null` and `undefined` never leak into
 * arithmetic as `NaN`.
 */
export function toNumber(value: Numeric | null | undefined, field: string): number {
  void value;
  void field;
  throw new Error('not implemented: toNumber');
}

/** Same as `toNumber`, but tolerates absence by returning `fallback`. */
export function toNumberOr(
  value: Numeric | null | undefined,
  field: string,
  fallback: number,
): number {
  void value;
  void field;
  void fallback;
  throw new Error('not implemented: toNumberOr');
}
