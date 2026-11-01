import { MyImoPayValidationError } from '../errors';

/**
 * Normalises a Nigerian mobile number to E.164 (`+2348031234567`).
 *
 * Accepted inputs: `08031234567`, `8031234567`, `2348031234567`,
 * `+2348031234567`, with optional spaces, dashes, dots or brackets.
 * Anything that is not a Nigerian number throws instead of being guessed at.
 */
export function normalizeNigerianPhone(phone: string): string {
  void phone;
  throw new Error('not implemented: normalizeNigerianPhone');
}

/** Validates and returns the normalised number. */
export function assertPhone(phone: unknown, field = 'customer.mobile'): string {
  void phone;
  void field;
  throw new MyImoPayValidationError('not implemented: assertPhone', field);
}
