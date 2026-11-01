// @sdk-owner: A0-contracts
// @sdk-phase: 1

import type { VerifiedPayment } from '@myimopay/core';
import type { CheckoutHint } from './parse';

/** How the hosted checkout is presented. */
export type CheckoutMode = 'redirect' | 'popup';

/** How a checkout ended. */
export type CheckoutOutcome =
  | 'redirected'
  | 'closed'
  | 'blocked'
  | 'timeout'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'error';

/**
 * The slice of `window` this package needs.
 *
 * Injected rather than referenced globally so the helper can be driven from a
 * test, an iframe or a server-side render without a DOM.
 */
export interface WindowLike {
  readonly closed: boolean;
  readonly location: { assign(url: string): void };
  open(url: string, target?: string, features?: string): WindowLike | null;
}

/**
 * Lifecycle callbacks. Every one is optional; supply only what you act on.
 *
 * Status callbacks (`onSuccess`, `onFailed`, `onExpired`) fire **only** when a
 * `verify` function is configured. The checkout return URL is a hint, never
 * proof of payment, so the SDK refuses to guess.
 */
export interface CheckoutHandlers {
  /** The hosted page was opened or navigation started. */
  onOpen?: (url: string) => void;
  /** The payer came back to `callbackUrl`. `hint.verified` is always false. */
  onReturn?: (hint: CheckoutHint) => void;
  /** A popup blocker stopped the checkout before it started. */
  onBlocked?: (url: string) => void;
  /** Verified as paid. */
  onSuccess?: (payment: VerifiedPayment) => void;
  onFailed?: (payment: VerifiedPayment) => void;
  onExpired?: (payment: VerifiedPayment) => void;
  /** Closed or timed out without a terminal, verified status. */
  onCancelled?: () => void;
  /** `verify` threw or the verification poll gave up. */
  onError?: (error: unknown) => void;
  /** Always fires last, exactly once. */
  onClose?: (result: CheckoutResult) => void;
}

export interface CheckoutOptions extends CheckoutHandlers {
  /** Default `redirect`. `popup` keeps the merchant page alive while paying. */
  mode?: CheckoutMode;
  /** The window to open into. Defaults to the caller's own window. */
  window?: WindowLike;
  /** How long a popup may stay open before resolving `timeout`. Default 300000ms. */
  timeoutMs?: number;
  /** Passed straight to `window.open`. Default `width=480,height=720`. */
  popupFeatures?: string;
  /**
   * Server-side verification, normally your own endpoint wrapping
   * `myimopay.payments.verify`. Enables `onSuccess`/`onFailed`/`onExpired`.
   * Never call the gateway directly from a browser.
   */
  verify?: (reference: string) => Promise<VerifiedPayment>;
  /** Poll cadence after the payer returns. Default 2000ms. */
  pollIntervalMs?: number;
  /** Give up verifying after this long. Default 120000ms. */
  pollTimeoutMs?: number;
}

export interface CheckoutResult {
  outcome: CheckoutOutcome;
  /** The provider URL that was (or would have been) opened. */
  url: string;
  /** The reference that was verified, when one was known. */
  reference: string | null;
  /** Present only for terminal, verified outcomes. */
  payment: VerifiedPayment | null;
}

/**
 * A checkout opener bound to one window and one mode.
 *
 * Returns a result instead of throwing: a popup blocker, a closed tab and a
 * timeout are normal outcomes of a checkout, not failures of the SDK.
 */
export interface Checkout {
  /** Opens the hosted page. Pass the payment reference to enable verification. */
  open(url: string, options?: { reference?: string }): Promise<CheckoutResult>;
  /**
   * Completes the redirect flow: reads the return URL, calls `onReturn`, then
   * verifies and fires the terminal callback.
   */
  resume(
    href: string,
    options?: { reference?: string; expectedReference?: string },
  ): Promise<CheckoutResult>;
}

/**
 * Creates a checkout opener.
 *
 * Keyless by design: the hosted page is opened by URL, and nothing about the
 * merchant's key is ever needed, stored or sent from the browser.
 */
export function createCheckout(options?: CheckoutOptions): Checkout {
  void options;
  throw new Error('not implemented: createCheckout');
}
