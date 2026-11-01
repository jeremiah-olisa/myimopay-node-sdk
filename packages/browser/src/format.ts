// @sdk-owner: A0-contracts
// @sdk-phase: 1

import type { PaymentStatus } from '@myimopay/core';

/**
 * Formats an amount for display (`₦1,500.10`).
 *
 * Amounts are major units everywhere in this SDK; the locale defaults to
 * `en-NG`, and an unknown currency code falls back to the code itself.
 */
export function formatAmount(amount: number, currency?: string, locale?: string): string {
  void amount;
  void currency;
  void locale;
  throw new Error('not implemented: formatAmount');
}

/** Payer-facing wording for a status. Never used to decide whether to grant value. */
export function describePaymentStatus(status: PaymentStatus): string {
  void status;
  throw new Error('not implemented: describePaymentStatus');
}
