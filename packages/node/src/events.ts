// @sdk-owner: A12-events
// @sdk-phase: 3

import { isTerminalStatus, MyImoPayValidationError, type PaymentStatus } from '@myimopay/core';

/** Why a subscription stopped. `onClose` always receives one of these. */
export type PaymentEventOutcome = 'succeeded' | 'failed' | 'expired' | 'timeout' | 'cancelled';

/**
 * What a subscriber receives when a payment settles.
 *
 * Deliberately a *signal*, not a ledger: it carries the reference and the
 * terminal status, and the caller re-reads the amount from its own records (or
 * a verification call) before granting value. A webhook body is attacker-
 * reachable in principle and must never be the source of a payable amount.
 */
export interface PaymentEvent {
  reference: string;
  providerReference: string | null;
  status: PaymentStatus;
  raw: unknown;
  /**
   * Set by the webhook helpers: `true` when the delivery's HMAC was checked.
   * The bus refuses `false` unless the caller confirms it verified the payment
   * itself, so a forged webhook cannot reach `onSuccess`.
   */
  verified?: boolean;
}

/**
 * Terminal callbacks for one reference. There is no `onPending`: pending is
 * not an event worth a handler, and a subscription that fires on it just
 * becomes a polling loop in disguise.
 */
export interface PaymentEventHandlers {
  onSuccess?: (event: PaymentEvent) => void | Promise<void>;
  onFailed?: (event: PaymentEvent) => void | Promise<void>;
  onExpired?: (event: PaymentEvent) => void | Promise<void>;
  /** Always fires last, exactly once: terminal delivery, unsubscribe or TTL. */
  onClose?: (outcome: PaymentEventOutcome) => void | Promise<void>;
}

export interface PaymentEventOptions {
  /** How long a subscription may wait for its event. Default 30 minutes. */
  ttlMs?: number;
}

/**
 * Event-based payment lifecycle.
 *
 * `on()` subscribes, the webhook route calls `emit()` with a verified event,
 * and exactly one terminal callback runs. There is no polling and no timer, so
 * a subscription costs one map entry and nothing else.
 */
export interface PaymentEventBus {
  /** Subscribes to one reference. Returns an idempotent unsubscribe. */
  on(reference: string, handlers: PaymentEventHandlers, options?: PaymentEventOptions): () => void;
  /**
   * Delivers an event to every subscriber for its reference.
   * Non-terminal statuses are ignored (returns 0). Returns the delivery count.
   *
   * An event explicitly marked `verified: false` is rejected unless
   * `{ allowUnverified: true }` is passed, which is the caller's assertion that
   * it verified the payment server-side first.
   */
  emit(event: PaymentEvent, options?: EmitOptions): Promise<number>;
  /** Live subscriptions, after lazily discarding expired ones. */
  readonly size: number;
  /** Closes every subscription with `cancelled`. */
  clear(): void;
}

export interface EmitOptions {
  /** Required to emit an event whose `verified` flag is `false`. */
  allowUnverified?: boolean;
}

export interface PaymentEventBusOptions {
  /** Default subscription lifetime. Default 30 minutes. */
  ttlMs?: number;
  /** Hard cap on live subscriptions. Default 10 000. */
  maxSubscriptions?: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SUBSCRIPTIONS = 10_000;

interface Subscription {
  handlers: PaymentEventHandlers;
  expiresAt: number;
  done: boolean;
}

export function createPaymentEventBus(options: PaymentEventBusOptions = {}): PaymentEventBus {
  const defaultTtlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxSubscriptions = options.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS;

  if (!Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0) {
    throw new MyImoPayValidationError('ttlMs must be a positive number.', 'ttlMs');
  }
  if (!Number.isInteger(maxSubscriptions) || maxSubscriptions <= 0) {
    throw new MyImoPayValidationError(
      'maxSubscriptions must be a positive integer.',
      'maxSubscriptions',
    );
  }

  const subscriptions = new Map<string, Subscription[]>();

  const close = (subscription: Subscription, outcome: PaymentEventOutcome): void => {
    if (subscription.done) return;
    subscription.done = true;
    safely(() => subscription.handlers.onClose?.(outcome));
  };

  const sweep = (now: number): void => {
    for (const [reference, list] of subscriptions) {
      for (const subscription of list) {
        if (!subscription.done && subscription.expiresAt <= now) close(subscription, 'timeout');
      }
      const live = list.filter((subscription) => !subscription.done);
      if (live.length === 0) subscriptions.delete(reference);
      else subscriptions.set(reference, live);
    }
  };

  const total = (): number => {
    let count = 0;
    for (const list of subscriptions.values()) {
      for (const subscription of list) if (!subscription.done) count += 1;
    }
    return count;
  };

  const evictOldest = (): void => {
    for (const [reference, list] of subscriptions) {
      const oldest = list[0];
      if (oldest !== undefined) {
        close(oldest, 'timeout');
        const rest = list.slice(1);
        if (rest.length === 0) subscriptions.delete(reference);
        else subscriptions.set(reference, rest);
        return;
      }
      subscriptions.delete(reference);
    }
  };

  const on: PaymentEventBus['on'] = (reference, handlers, subscribeOptions = {}) => {
    if (typeof reference !== 'string' || reference.trim() === '') {
      throw new MyImoPayValidationError(
        'A payment reference is required to subscribe.',
        'reference',
      );
    }
    if (typeof handlers !== 'object' || handlers === null) {
      throw new MyImoPayValidationError('handlers must be an object.', 'handlers');
    }
    if (
      handlers.onSuccess === undefined &&
      handlers.onFailed === undefined &&
      handlers.onExpired === undefined &&
      handlers.onClose === undefined
    ) {
      throw new MyImoPayValidationError(
        'Provide at least one handler: onSuccess, onFailed, onExpired or onClose.',
        'handlers',
      );
    }

    const ttlMs = subscribeOptions.ttlMs ?? defaultTtlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new MyImoPayValidationError('ttlMs must be a positive number.', 'ttlMs');
    }

    const now = Date.now();
    sweep(now);
    while (total() >= maxSubscriptions) evictOldest();

    const subscription: Subscription = {
      handlers,
      expiresAt: now + ttlMs,
      done: false,
    };
    const list = subscriptions.get(reference);
    if (list === undefined) subscriptions.set(reference, [subscription]);
    else list.push(subscription);

    return () => {
      if (subscription.done) return;
      close(subscription, 'cancelled');
      const current = subscriptions.get(reference);
      if (current === undefined) return;
      const rest = current.filter((entry) => entry !== subscription);
      if (rest.length === 0) subscriptions.delete(reference);
      else subscriptions.set(reference, rest);
    };
  };

  const emit: PaymentEventBus['emit'] = async (event, emitOptions = {}) => {
    if (typeof event.reference !== 'string' || event.reference.trim() === '') {
      throw new MyImoPayValidationError('An event needs a payment reference.', 'reference');
    }

    if (event.verified === false && emitOptions.allowUnverified !== true) {
      throw new MyImoPayValidationError(
        'This webhook event is unverified. Call payments.verify(reference) and emit the verified status, or pass { allowUnverified: true } after verifying it yourself.',
        'event.verified',
      );
    }

    sweep(Date.now());
    if (!isTerminalStatus(event.status)) return 0;

    const list = subscriptions.get(event.reference);
    if (list === undefined) return 0;
    subscriptions.delete(event.reference);

    let delivered = 0;
    for (const subscription of list) {
      if (subscription.done) continue;
      subscription.done = true;
      delivered += 1;

      const outcome = event.status as PaymentEventOutcome;
      const handler =
        outcome === 'succeeded'
          ? subscription.handlers.onSuccess
          : outcome === 'failed'
            ? subscription.handlers.onFailed
            : subscription.handlers.onExpired;

      await safelyAsync(() => handler?.(event));
      await safelyAsync(() => subscription.handlers.onClose?.(outcome));
    }

    return delivered;
  };

  return {
    on,
    emit,
    get size(): number {
      sweep(Date.now());
      return total();
    },
    clear(): void {
      for (const list of subscriptions.values()) {
        for (const subscription of list) close(subscription, 'cancelled');
      }
      subscriptions.clear();
    },
  };
}

/** Delivery must never reject into a webhook handler. */
function safely(run: () => void | Promise<void>): void {
  try {
    const result = run();
    if (result instanceof Promise) void result.catch(() => undefined);
  } catch {
    // A subscriber's failure is its own; the webhook response is unaffected.
  }
}

async function safelyAsync(run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    // See `safely`.
  }
}
