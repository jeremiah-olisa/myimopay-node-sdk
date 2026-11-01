import type { Amount, ChargeBearer, Currency, PaymentStatus } from './common';

/** Customer details attached to an initiation. */
export interface Customer {
  /** Required by the provider. Trailing/leading whitespace is trimmed. */
  fullName: string;
  /** Nigerian mobile. `0803…`, `803…`, `+234803…` are all accepted and normalised. */
  mobile: string;
  /** Optional; the provider rejects malformed addresses. */
  email?: string;
}

export interface InitiatePaymentInput {
  /** Major units, greater than 0, at most 2 decimal places. */
  amount: Amount;
  /** Defaults to `NGN`. */
  currency?: Currency;
  /**
   * Merchant reference, max 20 characters, `[A-Za-z0-9._-]`.
   * Omit to let the SDK generate one; this value is the provider's
   * idempotency key, so reuse it when retrying a payment you already created.
   */
  reference?: string;
  customer: Customer;
  /** Absolute https URL the payer returns to after checkout. */
  callbackUrl?: string;
}

export interface InitiateSplitPaymentInput extends InitiatePaymentInput {
  /** Settlement order that defines how the amount is distributed. */
  settlementOrderId: string;
}

/** Result of a successful initiation. */
export interface PaymentInitiation {
  /** The `tx_ref` that was sent (generated or supplied). */
  reference: string;
  /** Provider-side reference; falls back to `reference` when the provider omits it. */
  providerReference: string;
  /** Hosted checkout URL to send the payer to. */
  authorizationUrl: string;
  /** Provider expiry, falling back to the documented 24h window. */
  expiresAt: Date;
  amount: Amount;
  currency: Currency;
  /** Provider payload, untouched. */
  raw: unknown;
}

/** Result of a verification. Always re-verify server-side; a webhook is only a trigger. */
export interface VerifiedPayment {
  reference: string;
  providerReference: string | null;
  status: PaymentStatus;
  /** Provider integer status, kept for support tickets. */
  rawStatus: number | null;
  /** `data.is_settled` — the strongest signal the provider exposes. */
  isSettled: boolean;
  currency: Currency;
  /** `initial_amount` — what the merchant asked for. */
  amountInitial: Amount;
  /** `paid_amount`, falling back to `charged_amount`. */
  amountPaid: Amount;
  /** `charged_amount`, falling back to `paid_amount`. */
  amountCharged: Amount;
  /** `payout_amount` after fees, when present. */
  amountPayout: Amount;
  chargeBearer: ChargeBearer | null;
  isSplit: boolean;
  settlementOrderId: string | null;
  /** Payment-link expiry (`expiration_time`). */
  expiresAt: Date | null;
  raw: unknown;
}

/** Convenience guard for the only status that should grant value. */
export function isPaid(payment: Pick<VerifiedPayment, 'status'>): boolean {
  return payment.status === 'succeeded';
}
