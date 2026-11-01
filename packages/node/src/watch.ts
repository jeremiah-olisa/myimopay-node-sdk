// @sdk-owner: A0-contracts
// @sdk-phase: 1

import type { MyImoPayError, RequestOptions, VerifiedPayment } from '@myimopay/core';

/** Why a watch ended. `onClose` always receives one of these. */
export type WatchOutcome = 'succeeded' | 'failed' | 'expired' | 'timeout' | 'aborted' | 'error';

/**
 * Lifecycle callbacks for a payment your server is waiting on.
 *
 * Exactly one of `onSuccess`/`onFailed`/`onExpired` fires for a terminal
 * status, `onPending` may fire many times, and `onClose` always fires last.
 * Handlers may be async; they are awaited before the next poll.
 */
export interface PaymentWatchHandlers {
  onPending?: (payment: VerifiedPayment) => void | Promise<void>;
  onSuccess?: (payment: VerifiedPayment) => void | Promise<void>;
  onFailed?: (payment: VerifiedPayment) => void | Promise<void>;
  onExpired?: (payment: VerifiedPayment) => void | Promise<void>;
  /** Verification itself failed (network, auth, provider error). Watch stops. */
  onError?: (error: MyImoPayError) => void | Promise<void>;
  /** Always fires last, exactly once. */
  onClose?: (outcome: WatchOutcome) => void | Promise<void>;
}

export interface PaymentWatchOptions {
  /** Delay between verifications. Default 3000ms. */
  intervalMs?: number;
  /** Give up after this long. Default 300000ms (5 minutes). */
  timeoutMs?: number;
  /** Abort from the outside; closes with `aborted`. */
  signal?: AbortSignal;
  /** Per-verification transport overrides. */
  request?: RequestOptions;
}

/** Control handle returned immediately so the caller can always stop the watch. */
export interface PaymentWatcher {
  stop(): void;
  /** Resolves with the last verified payment, or `null` when nothing was verified. */
  readonly done: Promise<VerifiedPayment | null>;
}

/** The verification function a watch delegates to (normally `payments.verify`). */
export type VerifyPayment = (
  reference: string,
  options?: RequestOptions,
) => Promise<VerifiedPayment>;

/**
 * Polls `verify` until the payment is terminal, the caller stops it, or the
 * timeout elapses. No background timers survive `onClose`.
 */
export function watchPayment(
  verify: VerifyPayment,
  reference: string,
  handlers?: PaymentWatchHandlers,
  options?: PaymentWatchOptions,
): PaymentWatcher {
  void verify;
  void reference;
  void handlers;
  void options;
  throw new Error('not implemented: watchPayment');
}
