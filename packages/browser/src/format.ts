// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: A8-browser

import { formatMoney, type PaymentStatus } from '@myimopay/core';

/**
 * Formats an amount for display (`₦1,500.10`).
 *
 * Amounts are major units everywhere in this SDK; the locale defaults to
 * `en-NG`, and an unknown currency code falls back to the code itself.
 */
export function formatAmount(amount: number, currency = 'NGN', locale?: string): string {
  return formatMoney(amount, currency, locale);
}

/** Payer-facing wording for a status. Never used to decide whether to grant value. */
export function describePaymentStatus(status: PaymentStatus): string {
  switch (status) {
    case 'succeeded':
      return 'Paid';
    case 'pending':
      return 'Pending';
    case 'initiated':
      return 'Awaiting payment';
    case 'failed':
      return 'Failed';
    case 'expired':
      return 'Expired';
    case 'unknown':
      return 'Unknown';
  }
}
