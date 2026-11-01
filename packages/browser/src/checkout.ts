// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: A8-browser

import {
  assertHttpsUrl,
  MyImoPayValidationError,
  type PaymentStatus,
  type VerifiedPayment,
} from '@myimopay/core';
import type { CheckoutHint } from './parse';
import { parseCheckoutResult } from './parse';

/** How the hosted checkout is presented. */
export type CheckoutMode = 'redirect' | 'popup';

/**
 * How a checkout ended.
 *
 * `returned` is `resume()` with nothing to verify: either the return URL
 * carried no reference or no `verify` function was configured. The payer came
 * back, but no payment conclusion is available.
 */
export type CheckoutOutcome =
  | 'redirected'
  | 'returned'
  | 'closed'
  | 'blocked'
  | 'timeout'
  | 'succeeded'
  | 'failed'
  | 'expired'
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
  /**
   * The provider URL that was (or would have been) opened. `resume()` reports
   * the return `href` it was given, since nothing is opened there.
   */
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

/** Default life of a popup before `open` gives up. */
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POPUP_FEATURES = 'width=480,height=720';
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

/** Stable `window.open` target, so a repeated checkout reuses the same popup. */
const POPUP_TARGET = 'myimopay-checkout';
/** How often a popup is checked for `closed`. */
const POPUP_CLOSE_POLL_MS = 250;

const HANDLER_KEYS = [
  'onOpen',
  'onReturn',
  'onBlocked',
  'onSuccess',
  'onFailed',
  'onExpired',
  'onCancelled',
  'onError',
  'onClose',
] as const satisfies readonly (keyof CheckoutHandlers)[];

type TimerHandle = ReturnType<typeof setTimeout>;

/** Everything `createCheckout` decided up front, defaults resolved. */
interface ResolvedConfig {
  readonly mode: CheckoutMode;
  readonly window: WindowLike | undefined;
  readonly timeoutMs: number;
  readonly popupFeatures: string;
  readonly verify: ((reference: string) => Promise<VerifiedPayment>) | undefined;
  readonly pollIntervalMs: number;
  readonly pollTimeoutMs: number;
  readonly handlers: CheckoutHandlers;
}

/** One checkout call: owns the timers, the settle-once flag and the promise. */
interface Session {
  readonly promise: Promise<CheckoutResult>;
  isClosed(): boolean;
  schedule(task: () => void, delayMs: number): void;
  /** `onCancelled`, at most once, never alongside a status callback. */
  cancel(): void;
  /** `onClose`, exactly once, always last. */
  close(outcome: CheckoutOutcome, payment?: VerifiedPayment | null): void;
}

interface TerminalStep {
  readonly outcome: CheckoutOutcome;
  readonly handler: ((payment: VerifiedPayment) => void) | undefined;
}

/**
 * Creates a checkout opener.
 *
 * Keyless by design: the hosted page is opened by URL, and nothing about the
 * merchant's key is ever needed, stored or sent from the browser.
 *
 * Invalid configuration throws `MyImoPayValidationError` immediately, and so
 * does `open()` with a URL that is not absolute `https:`. Everything that can
 * happen while a person is paying — blocked, closed, timed out, cancelled —
 * resolves instead.
 */
export function createCheckout(options?: CheckoutOptions): Checkout {
  const config = resolveConfig(options);

  return {
    open(url, openOptions) {
      const targetUrl = assertHttpsUrl(url, 'url');
      const target = config.window ?? defaultWindow();
      if (target === undefined) {
        throw new MyImoPayValidationError(
          'window must be supplied when no global window is available; pass options.window.',
          'window',
        );
      }
      return openCheckout(config, target, targetUrl, openOptions?.reference ?? null);
    },
    resume(href, resumeOptions) {
      return resumeCheckout(config, href, resumeOptions);
    },
  };
}

function resolveConfig(options: CheckoutOptions | undefined): ResolvedConfig {
  const handlers: CheckoutHandlers = options ?? {};
  const mode = options?.mode ?? 'redirect';

  if (mode !== 'redirect' && mode !== 'popup') {
    throw new MyImoPayValidationError(
      `mode must be "redirect" or "popup"; received ${show(mode)}.`,
      'mode',
    );
  }

  const window = options?.window;
  if (window !== undefined) assertWindowLike(window);

  const verify = options?.verify;
  if (verify !== undefined && typeof verify !== 'function') {
    throw new MyImoPayValidationError(
      `verify must be a function when supplied; received ${show(verify)}.`,
      'verify',
    );
  }

  assertHandlers(handlers);

  const popupFeatures = options?.popupFeatures ?? DEFAULT_POPUP_FEATURES;
  if (typeof popupFeatures !== 'string' || popupFeatures.trim() === '') {
    throw new MyImoPayValidationError(
      `popupFeatures must be a non-empty string when supplied; received ${show(popupFeatures)}.`,
      'popupFeatures',
    );
  }

  return {
    mode,
    window,
    timeoutMs: resolveDuration(options?.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs'),
    popupFeatures,
    verify,
    pollIntervalMs: resolveDuration(
      options?.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      'pollIntervalMs',
    ),
    pollTimeoutMs: resolveDuration(
      options?.pollTimeoutMs,
      DEFAULT_POLL_TIMEOUT_MS,
      'pollTimeoutMs',
    ),
    handlers,
  };
}

function openCheckout(
  config: ResolvedConfig,
  target: WindowLike,
  url: string,
  reference: string | null,
): Promise<CheckoutResult> {
  const session = beginSession(url, reference, config.handlers);
  callHandler(config.handlers.onOpen, url);

  if (config.mode === 'redirect') {
    try {
      target.location.assign(url);
    } catch (error) {
      callHandler(config.handlers.onError, error);
      session.close('error');
      return session.promise;
    }
    session.close('redirected');
    return session.promise;
  }

  const popup = openPopup(target, url, config.popupFeatures);
  if (popup === null) {
    callHandler(config.handlers.onBlocked, url);
    session.close('blocked');
    return session.promise;
  }

  watchPopup(popup, config.timeoutMs, session, () => {
    if (session.isClosed()) return;
    if (reference === null || config.verify === undefined) {
      session.cancel();
      session.close('closed');
      return;
    }
    startVerification(config, session, reference);
  });

  return session.promise;
}

function resumeCheckout(
  config: ResolvedConfig,
  href: string,
  options: { reference?: string; expectedReference?: string } | undefined,
): Promise<CheckoutResult> {
  const expectedReference = options?.expectedReference;
  const hint = parseCheckoutResult(
    href,
    expectedReference === undefined ? undefined : { expectedReference },
  );
  const reference = options?.reference ?? hint.reference;
  const session = beginSession(href, reference, config.handlers);

  callHandler(config.handlers.onReturn, hint);

  if (reference === null || config.verify === undefined) {
    session.cancel();
    session.close('returned');
    return session.promise;
  }

  startVerification(config, session, reference);
  return session.promise;
}

/**
 * Polls `verify` until a terminal status, the deadline or a failure.
 *
 * The deadline is its own timer, so a `verify` that never settles still closes
 * the checkout; every timer is cleared by `Session.close`.
 */
function startVerification(config: ResolvedConfig, session: Session, reference: string): void {
  const verify = config.verify;
  if (verify === undefined) return;

  const poll = async (): Promise<void> => {
    if (session.isClosed()) return;

    let payment: VerifiedPayment;
    try {
      payment = await verify(reference);
    } catch (error) {
      // A late failure after `onClose` must not resurrect the checkout.
      if (session.isClosed()) return;

      callHandler(config.handlers.onError, error);
      session.close('error');
      return;
    }

    if (session.isClosed()) return;

    const step = terminalStep(payment.status, config.handlers);
    if (step !== null) {
      callHandler(step.handler, payment);
      session.close(step.outcome, payment);
      return;
    }

    session.schedule(() => {
      void poll();
    }, config.pollIntervalMs);
  };

  session.schedule(() => {
    session.cancel();
    session.close('timeout');
  }, config.pollTimeoutMs);

  void poll();
}

/**
 * Watches a popup until it closes or `timeoutMs` elapses.
 *
 * The timers are local so they can be dropped the moment the popup closes and
 * verification takes over; a late popup timeout must never cut a live
 * verification short.
 */
function watchPopup(
  popup: WindowLike,
  timeoutMs: number,
  session: Session,
  onClosed: () => void,
): void {
  let pollTimer: TimerHandle | undefined;
  let timeoutTimer: TimerHandle | undefined;

  const stop = (): void => {
    if (pollTimer !== undefined) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
  };

  const schedulePoll = (): void => {
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      if (session.isClosed()) {
        stop();
        return;
      }
      if (popup.closed) {
        stop();
        onClosed();
        return;
      }
      schedulePoll();
    }, POPUP_CLOSE_POLL_MS);
  };

  // A popup that is already gone needs no waiting at all.
  if (popup.closed) {
    stop();
    onClosed();
    return;
  }

  schedulePoll();
  timeoutTimer = setTimeout(() => {
    timeoutTimer = undefined;
    stop();
    if (session.isClosed()) return;

    session.cancel();
    session.close('timeout');
  }, timeoutMs);
}

function beginSession(url: string, reference: string | null, handlers: CheckoutHandlers): Session {
  let closed = false;
  let cancelled = false;
  const timers = new Set<TimerHandle>();
  let resolve: (result: CheckoutResult) => void = () => {};

  const promise = new Promise<CheckoutResult>((settle) => {
    resolve = settle;
  });

  return {
    promise,
    isClosed: () => closed,
    schedule(task, delayMs) {
      if (closed) return;

      const timer = setTimeout(() => {
        timers.delete(timer);
        task();
      }, delayMs);
      timers.add(timer);
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      callHandler(handlers.onCancelled);
    },
    close(outcome, payment = null) {
      if (closed) return;
      // Set synchronously, so a racing timer can never double-close.
      closed = true;

      for (const timer of timers) clearTimeout(timer);
      timers.clear();

      const result: CheckoutResult = { outcome, url, reference, payment };
      callHandler(handlers.onClose, result);
      resolve(result);
    },
  };
}

/** The one terminal callback + outcome for a terminal status. */
function terminalStep(status: PaymentStatus, handlers: CheckoutHandlers): TerminalStep | null {
  switch (status) {
    case 'succeeded':
      return { outcome: 'succeeded', handler: handlers.onSuccess };
    case 'failed':
      return { outcome: 'failed', handler: handlers.onFailed };
    case 'expired':
      return { outcome: 'expired', handler: handlers.onExpired };
    case 'initiated':
    case 'pending':
    case 'unknown':
      return null;
  }
}

function openPopup(target: WindowLike, url: string, features: string): WindowLike | null {
  try {
    return target.open(url, POPUP_TARGET, features);
  } catch {
    // A `window.open` that throws is a blocker in every browser that matters.
    return null;
  }
}

/**
 * Runs a merchant callback without letting it break the lifecycle.
 *
 * A throwing `onSuccess` must not stop `onClose` from firing exactly once.
 */
function callHandler<Args extends unknown[]>(
  handler: ((...args: Args) => void) | undefined,
  ...args: Args
): void {
  if (handler === undefined) return;

  try {
    handler(...args);
  } catch {
    // Merchant callbacks are fire-and-forget; their failures are not ours.
  }
}

function assertHandlers(handlers: CheckoutHandlers): void {
  for (const key of HANDLER_KEYS) {
    const handler = handlers[key];
    if (handler !== undefined && typeof handler !== 'function') {
      throw new MyImoPayValidationError(
        `${key} must be a function when supplied; received ${show(handler)}.`,
        key,
      );
    }
  }
}

function assertWindowLike(value: unknown): WindowLike {
  if (!isWindowLike(value)) {
    throw new MyImoPayValidationError(
      `window must be a WindowLike object exposing location.assign and open; received ${show(value)}.`,
      'window',
    );
  }
  return value;
}

function isWindowLike(value: unknown): value is WindowLike {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as { open?: unknown; location?: { assign?: unknown } };
  return typeof candidate.open === 'function' && typeof candidate.location?.assign === 'function';
}

/** The caller's window, when there is one. */
function defaultWindow(): WindowLike | undefined {
  const candidate: unknown = globalThis.window;
  return isWindowLike(candidate) ? candidate : undefined;
}

function resolveDuration(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback;
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved <= 0) {
    throw new MyImoPayValidationError(
      `${field} must be a positive number of milliseconds; received ${show(resolved)}.`,
      field,
    );
  }
  return resolved;
}

/** Renders the offending value for an error message without coercing objects. */
function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}
