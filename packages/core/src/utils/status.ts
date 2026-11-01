// @sdk-implemented-by: F2-primitives
import type { ChargeBearer, Numeric, PaymentStatus } from '../types/common';

/**
 * Non-throwing numeric parse. `mapPaymentStatus` runs on provider payloads, so
 * an unusable status must map to `unknown`, never raise.
 */
function parseNumeric(value: Numeric | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

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
  // The strongest signal the provider sends: money has landed. Check it first.
  if (isSettled === true) return 'succeeded';

  const parsed = parseNumeric(status);
  if (parsed === null) return 'unknown';

  switch (parsed) {
    case 0:
      return 'initiated';
    case 1:
      return 'pending';
    case 2:
      return 'succeeded';
    case 3:
      return 'failed';
    case 4:
      return 'expired';
    default:
      return 'unknown';
  }
}

/** `1 merchant`, `2 customer`, `3 split`, anything else `null`. */
export function mapChargeBearer(bearer: Numeric | null | undefined): ChargeBearer | null {
  const parsed = parseNumeric(bearer);

  switch (parsed) {
    case 1:
      return 'merchant';
    case 2:
      return 'customer';
    case 3:
      return 'split';
    default:
      return null;
  }
}

/** True when reconciliation should stop retrying this payment. */
export function isTerminalStatus(status: PaymentStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'expired';
}
