import type { ChargeBearer, Numeric, PaymentStatus } from '../types/common';

/**
 * Maps the provider's integer status to the SDK's status union.
 *
 * `0 initiated`, `1 pending`, `2 success`, `3 failed`, `4 expired`,
 * anything else `unknown`. A settled transaction is always `succeeded`
 * regardless of the integer, because `is_settled` is the provider's own
 * "money has landed" flag.
 */
export function mapPaymentStatus(
  status: Numeric | null | undefined,
  isSettled?: boolean | null,
): PaymentStatus {
  void status;
  void isSettled;
  throw new Error('not implemented: mapPaymentStatus');
}

/** `1 merchant`, `2 customer`, `3 split`, anything else `null`. */
export function mapChargeBearer(bearer: Numeric | null | undefined): ChargeBearer | null {
  void bearer;
  throw new Error('not implemented: mapChargeBearer');
}

/** True when reconciliation should stop retrying this payment. */
export function isTerminalStatus(status: PaymentStatus): boolean {
  void status;
  throw new Error('not implemented: isTerminalStatus');
}
