// @sdk-owner: A0-contracts
// @sdk-phase: 1

import type { PaymentStatus } from '@myimopay/core';

/**
 * The normalised shape of a provider webhook delivery.
 *
 * MyIMO Pay does not sign webhooks, so `raw` is the provider payload exactly as
 * parsed from the raw body. Every field here is a projection of it, which means
 * `constructEvent` never invents a status the provider did not send.
 */
export interface WebhookEvent {
  /** The merchant `tx_ref` the delivery is about. */
  reference: string;
  /** Provider-side reference, when the payload carries one. */
  providerReference: string | null;
  status: PaymentStatus;
  /** Provider integer status, kept for support tickets. */
  rawStatus: number | null;
  /** `data.is_settled` — the strongest signal the provider exposes. */
  isSettled: boolean;
  amountPaid: number;
  currency: string;
  /** Delivery identifier, when present. Used for de-duplication. */
  eventId: string | null;
  /** Provider payload, untouched. */
  raw: unknown;
}

/** What `constructEvent` needs in order to authenticate a delivery. */
export interface WebhookOptions {
  /**
   * Shared secret used for the HMAC both production integrations verify with.
   * This is the merchant's own secret, not a provider-issued webhook key.
   */
  secret: string;
  /** Header carrying the hex digest. Default `x-myimopay-signature`. */
  headerName?: string;
}

/**
 * Constant-time check of an HMAC-SHA256 hex digest over the raw request body.
 *
 * Returns `false` for a missing, malformed or mismatched signature; never
 * throws, so a caller can answer `401` without branching on error types.
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  secret: string,
): boolean {
  void rawBody;
  void signature;
  void secret;
  throw new Error('not implemented: verifyWebhookSignature');
}

/**
 * Verifies the delivery and projects it into a `WebhookEvent`.
 *
 * Throws `MyImoPayWebhookError` when the signature does not match — an
 * unverified delivery must never be parsed into an event.
 */
export function constructEvent(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  options: WebhookOptions,
): WebhookEvent {
  void rawBody;
  void signature;
  void options;
  throw new Error('not implemented: constructEvent');
}

/** The digest `verifyWebhookSignature` expects, for tests and local replay. */
export function signWebhookPayload(rawBody: string, secret: string): string {
  void rawBody;
  void secret;
  throw new Error('not implemented: signWebhookPayload');
}
