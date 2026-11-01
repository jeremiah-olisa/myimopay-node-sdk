// @sdk-owner: A0-contracts
// @sdk-phase: 1

/**
 * What a checkout return page actually tells you.
 *
 * A query string is attacker-controlled: anyone can navigate to
 * `/thank-you?status=success`. This is a hint to decide what to render, never
 * evidence that money moved — the server must call `payments.verify` first.
 */
export interface CheckoutHint {
  reference: string | null;
  /** The provider's raw status word from the query string, if any. */
  statusHint: string | null;
  /** False when `expectedReference` was supplied and does not match. */
  referenceMatches: boolean;
  /** Everything the provider put in the query string, untouched. */
  rawQuery: Record<string, string>;
  /** Always false in v1: a checkout return is a hint, never proof of payment. */
  verified: false;
}

/**
 * Reads a checkout return query string.
 *
 * Accepts a bare `?a=b` or a full URL. Never throws: unknown keys are kept in
 * `rawQuery`, and a missing reference is a legitimate `null`.
 */
export function parseCheckoutResult(
  search: string,
  options?: { expectedReference?: string },
): CheckoutHint {
  void search;
  void options;
  throw new Error('not implemented: parseCheckoutResult');
}
