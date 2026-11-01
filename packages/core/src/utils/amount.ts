import { MyImoPayValidationError } from '../errors';
import type { Amount } from '../types/common';

/**
 * Validates a caller amount and serialises it for the wire.
 *
 * Provider rule: a positive amount in major units, at most two decimals.
 * The SDK sends a fixed-point string so no float rounding can creep in
 * (`1500.1` → `"1500.10"`).
 */
export function toApiAmount(amount: Amount, field = 'amount'): string {
  void amount;
  void field;
  throw new Error('not implemented: toApiAmount');
}

/** Throws `MyImoPayValidationError` unless `amount` is a usable payment amount. */
export function assertAmount(amount: unknown, field?: string): asserts amount is Amount {
  void amount;
  void field;
  throw new MyImoPayValidationError('not implemented: assertAmount', field);
}

/** Human formatting for UI (`₦1,500.10`). Currency symbol falls back to the code. */
export function formatMoney(amount: Amount, currency = 'NGN', locale = 'en-NG'): string {
  void amount;
  void currency;
  void locale;
  throw new Error('not implemented: formatMoney');
}
