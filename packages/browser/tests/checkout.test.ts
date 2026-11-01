// @sdk-owner: A8-browser
// @sdk-phase: 1
// @sdk-implemented-by: A8-browser

import { describe, expect, it } from 'bun:test';
import type { CheckoutMode, CheckoutOptions, WindowLike } from '@browser/checkout';
import { createCheckout } from '@browser/checkout';
import type { CheckoutHint } from '@browser/parse';
import { MyImoPayValidationError } from '@core/errors';
import type { PaymentStatus } from '@core/types/common';
import type { VerifiedPayment } from '@core/types/payments';

const CHECKOUT_URL = 'https://checkout.example/pay/abc?ref=1';

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function verified(status: PaymentStatus): VerifiedPayment {
  return {
    reference: 'ref-1',
    providerReference: 'ref-1',
    status,
    rawStatus: null,
    isSettled: status === 'succeeded',
    currency: 'NGN',
    amountInitial: 50,
    amountPaid: status === 'succeeded' ? 50 : 0,
    amountCharged: 0,
    amountPayout: 0,
    chargeBearer: null,
    isSplit: false,
    settlementOrderId: null,
    expiresAt: null,
    raw: null,
  };
}

interface OpenCall {
  readonly url: string;
  readonly target: string | undefined;
  readonly features: string | undefined;
}

/** A popup whose `closed` flag the test drives. */
interface MutablePopup {
  closed: boolean;
  readonly location: { assign(url: string): void };
  open(url: string, target?: string, features?: string): WindowLike | null;
}

function fakePopup(closed = false): MutablePopup {
  return {
    closed,
    location: { assign: (): void => undefined },
    open: (): WindowLike | null => null,
  };
}

interface FakeWindow {
  readonly window: WindowLike;
  /** URLs handed to `location.assign`. */
  readonly assigned: string[];
  /** Every `window.open` call, in order. */
  readonly opened: OpenCall[];
  /** What the next `window.open` returns. `null` is a blocked popup. */
  popup: MutablePopup | null;
}

function fakeWindow(): FakeWindow {
  const assigned: string[] = [];
  const opened: OpenCall[] = [];
  const state: { popup: MutablePopup | null } = { popup: null };

  return {
    assigned,
    opened,
    get popup(): MutablePopup | null {
      return state.popup;
    },
    set popup(value: MutablePopup | null) {
      state.popup = value;
    },
    window: {
      closed: false,
      location: {
        assign: (url: string): void => {
          assigned.push(url);
        },
      },
      open: (url: string, target?: string, features?: string): WindowLike | null => {
        opened.push({ url, target, features });
        return state.popup;
      },
    },
  };
}

describe('createCheckout validation', () => {
  it('rejects a mode outside redirect/popup', () => {
    const mode = 'tab' as unknown as CheckoutMode;

    expect(() => createCheckout({ mode })).toThrow(MyImoPayValidationError);
  });

  it('rejects non-positive durations', () => {
    expect(() => createCheckout({ timeoutMs: 0 })).toThrow(MyImoPayValidationError);
    expect(() => createCheckout({ timeoutMs: -1 })).toThrow(MyImoPayValidationError);
    expect(() => createCheckout({ timeoutMs: Number.NaN })).toThrow(MyImoPayValidationError);
    expect(() => createCheckout({ pollIntervalMs: 0 })).toThrow(MyImoPayValidationError);
    expect(() => createCheckout({ pollTimeoutMs: 0 })).toThrow(MyImoPayValidationError);
  });

  it('rejects a non-function verify or handler', () => {
    const verify = 'nope' as unknown as NonNullable<CheckoutOptions['verify']>;
    const onOpen = 'nope' as unknown as NonNullable<CheckoutOptions['onOpen']>;
    const onClose = 'nope' as unknown as NonNullable<CheckoutOptions['onClose']>;
    const badWindow = {} as WindowLike;

    expect(() => createCheckout({ verify })).toThrow(MyImoPayValidationError);
    expect(() => createCheckout({ onOpen })).toThrow(MyImoPayValidationError);
    expect(() => createCheckout({ onClose })).toThrow(MyImoPayValidationError);
    expect(() => createCheckout({ window: badWindow })).toThrow(MyImoPayValidationError);
  });

  it('rejects non-https checkout URLs before opening anything', () => {
    const fake = fakeWindow();
    const checkout = createCheckout({ window: fake.window });

    expect(() => {
      void checkout.open('http://checkout.example/pay');
    }).toThrow(MyImoPayValidationError);
    expect(fake.assigned).toEqual([]);
    expect(fake.opened).toEqual([]);
  });

  it('rejects empty popup features', () => {
    expect(() => createCheckout({ popupFeatures: '' })).toThrow(MyImoPayValidationError);
  });

  it('throws when no window is available at all', () => {
    const checkout = createCheckout();

    expect(() => {
      void checkout.open(CHECKOUT_URL);
    }).toThrow(MyImoPayValidationError);
  });
});

describe('open in redirect mode', () => {
  it('assigns the URL and closes immediately after onOpen', async () => {
    const fake = fakeWindow();
    const events: string[] = [];
    const checkout = createCheckout({
      window: fake.window,
      onOpen: (url) => events.push(`open:${url}`),
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL);

    expect(fake.assigned).toEqual([CHECKOUT_URL]);
    expect(fake.opened).toEqual([]);
    expect(events).toEqual([`open:${CHECKOUT_URL}`, 'close:redirected']);
    expect(result).toEqual({
      outcome: 'redirected',
      url: CHECKOUT_URL,
      reference: null,
      payment: null,
    });
  });

  it('reports the reference but never verifies on a redirect', async () => {
    const fake = fakeWindow();
    let calls = 0;
    const checkout = createCheckout({
      window: fake.window,
      verify: async () => {
        calls += 1;
        return verified('succeeded');
      },
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(result.outcome).toBe('redirected');
    expect(result.reference).toBe('ref-1');
    expect(calls).toBe(0);
  });

  it('swallows handler exceptions and still closes exactly once', async () => {
    const fake = fakeWindow();
    let closes = 0;
    const checkout = createCheckout({
      window: fake.window,
      onOpen: () => {
        throw new Error('onOpen exploded');
      },
      onClose: () => {
        closes += 1;
        throw new Error('onClose exploded');
      },
    });

    const result = await checkout.open(CHECKOUT_URL);

    expect(result.outcome).toBe('redirected');
    expect(closes).toBe(1);
  });

  it('reports a navigation that throws as an error outcome', async () => {
    const events: string[] = [];
    const errors: unknown[] = [];
    const navigation: WindowLike = {
      closed: false,
      location: {
        assign: () => {
          throw new Error('navigation refused');
        },
      },
      open: () => null,
    };
    const checkout = createCheckout({
      window: navigation,
      onError: (error) => {
        errors.push(error);
        events.push('error');
      },
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL);

    expect(result.outcome).toBe('error');
    expect(result.payment).toBeNull();
    expect(errors).toHaveLength(1);
    expect(events).toEqual(['error', 'close:error']);
  });
});

describe('open in popup mode', () => {
  it('reports a blocked popup without cancelling', async () => {
    const fake = fakeWindow();
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 40,
      onBlocked: (url) => events.push(`blocked:${url}`),
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(fake.opened).toEqual([
      { url: CHECKOUT_URL, target: 'myimopay-checkout', features: 'width=480,height=720' },
    ]);
    expect(events).toEqual([`blocked:${CHECKOUT_URL}`, 'close:blocked']);
    expect(result.outcome).toBe('blocked');
    expect(result.payment).toBeNull();
  });

  it('closes as closed when the popup closes without verify', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 40,
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(result.outcome).toBe('closed');
    expect(result.reference).toBe('ref-1');
    expect(result.payment).toBeNull();
    expect(events).toEqual(['cancelled', 'close:closed']);
  });

  it('verifies after the popup closes and reports success', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const payment = verified('succeeded');
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 40,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async () => payment,
      onSuccess: (paid) => events.push(`success:${paid.reference}`),
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(result.outcome).toBe('succeeded');
    expect(result.payment).toBe(payment);
    expect(events).toEqual(['success:ref-1', 'close:succeeded']);

    // The verification deadline must not close a settled checkout a second time.
    await sleep(40);
    expect(events).toEqual(['success:ref-1', 'close:succeeded']);
  });

  it('reports a failed payment', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 40,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async () => verified('failed'),
      onFailed: (payment) => events.push(`failed:${payment.status}`),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(result.outcome).toBe('failed');
    expect(events).toEqual(['failed:failed', 'close:failed']);
  });

  it('reports an expired payment', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 40,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async () => verified('expired'),
      onExpired: () => events.push('expired'),
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(result.outcome).toBe('expired');
    expect(events).toEqual(['expired', 'close:expired']);
  });

  it('polls until the status becomes terminal', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const statuses: PaymentStatus[] = ['pending', 'pending', 'succeeded'];
    const calls: PaymentStatus[] = [];
    let index = 0;
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 40,
      pollIntervalMs: 1,
      pollTimeoutMs: 50,
      verify: async () => {
        const status = statuses[Math.min(index, statuses.length - 1)] ?? 'pending';
        index += 1;
        calls.push(status);
        return verified(status);
      },
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(calls).toEqual(['pending', 'pending', 'succeeded']);
    expect(result.outcome).toBe('succeeded');
  });

  it('times out a verification that never reaches a terminal status', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 60,
      pollIntervalMs: 2,
      pollTimeoutMs: 15,
      verify: async () => verified('pending'),
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(result.outcome).toBe('timeout');
    expect(result.payment).toBeNull();
    expect(events).toEqual(['cancelled', 'close:timeout']);
  });

  it('reports a throwing verify as an error outcome', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const failure = new Error('verify exploded');
    const events: string[] = [];
    const errors: unknown[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 40,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async () => {
        throw failure;
      },
      onError: (error) => {
        errors.push(error);
        events.push('error');
      },
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(errors).toEqual([failure]);
    expect(result.outcome).toBe('error');
    expect(result.payment).toBeNull();
    expect(events).toEqual(['error', 'close:error']);
  });

  it('times out a popup that never closes, without verifying', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(false);
    let calls = 0;
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 15,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async () => {
        calls += 1;
        return verified('succeeded');
      },
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });

    expect(result.outcome).toBe('timeout');
    expect(calls).toBe(0);
    expect(events).toEqual(['cancelled', 'close:timeout']);
  });

  it('ignores a verification that settles after the deadline', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 60,
      pollIntervalMs: 1,
      pollTimeoutMs: 10,
      verify: async () => {
        await sleep(40);
        return verified('succeeded');
      },
      onSuccess: () => events.push('success'),
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });
    expect(result.outcome).toBe('timeout');

    await sleep(50);
    expect(events).toEqual(['cancelled', 'close:timeout']);
  });

  it('ignores a verification failure that lands after the deadline', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    const events: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 60,
      pollIntervalMs: 1,
      pollTimeoutMs: 10,
      verify: async () => {
        await sleep(40);
        throw new Error('late failure');
      },
      onError: () => events.push('error'),
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL, { reference: 'ref-1' });
    expect(result.outcome).toBe('timeout');

    await sleep(50);
    expect(events).toEqual(['cancelled', 'close:timeout']);
  });

  it('polls a popup until it closes and keeps the popup timeout out of verification', async () => {
    const fake = fakeWindow();
    const popup = fakePopup(false);
    fake.popup = popup;
    const closes: string[] = [];
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      // Long enough for the poll below, short enough to catch a leaked timeout.
      timeoutMs: 300,
      pollIntervalMs: 1,
      pollTimeoutMs: 200,
      verify: async () => {
        await sleep(80);
        return verified('succeeded');
      },
      onClose: (result) => closes.push(result.outcome),
    });

    const pending = checkout.open(CHECKOUT_URL, { reference: 'ref-1' });
    setTimeout(() => {
      popup.closed = true;
    }, 10);

    const result = await pending;

    expect(result.outcome).toBe('succeeded');
    expect(closes).toEqual(['succeeded']);
  });

  it('reports a throwing window.open as a blocked popup', async () => {
    const events: string[] = [];
    const blocked: WindowLike = {
      closed: false,
      location: { assign: (): void => undefined },
      open: () => {
        throw new Error('popup blocked');
      },
    };
    const checkout = createCheckout({
      mode: 'popup',
      window: blocked,
      onBlocked: (url) => events.push(`blocked:${url}`),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.open(CHECKOUT_URL);

    expect(result.outcome).toBe('blocked');
    expect(events).toEqual([`blocked:${CHECKOUT_URL}`, 'close:blocked']);
  });

  it('closes exactly once per call', async () => {
    const fake = fakeWindow();
    fake.popup = fakePopup(true);
    let closes = 0;
    const checkout = createCheckout({
      mode: 'popup',
      window: fake.window,
      timeoutMs: 40,
      onClose: () => {
        closes += 1;
      },
    });

    await checkout.open(CHECKOUT_URL);
    await checkout.open(CHECKOUT_URL);

    expect(closes).toBe(2);
    expect(fake.opened).toHaveLength(2);
  });
});

describe('resume', () => {
  it('verifies the reference found in the return URL', async () => {
    const fake = fakeWindow();
    const payment = verified('succeeded');
    const hints: CheckoutHint[] = [];
    const seen: string[] = [];
    const checkout = createCheckout({
      window: fake.window,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async (reference) => {
        seen.push(reference);
        return payment;
      },
      onReturn: (hint) => hints.push(hint),
    });

    const href = 'https://app.example/thank-you?tx_ref=ref-7&status=success';
    const result = await checkout.resume(href, { expectedReference: 'ref-7' });

    expect(seen).toEqual(['ref-7']);
    expect(result).toEqual({
      outcome: 'succeeded',
      url: href,
      reference: 'ref-7',
      payment,
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]?.reference).toBe('ref-7');
    expect(hints[0]?.statusHint).toBe('success');
    expect(hints[0]?.referenceMatches).toBe(true);
    expect(hints[0]?.verified).toBe(false);
  });

  it('prefers an explicit reference over the query string', async () => {
    const fake = fakeWindow();
    const seen: string[] = [];
    const checkout = createCheckout({
      window: fake.window,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async (reference) => {
        seen.push(reference);
        return verified('succeeded');
      },
    });

    const result = await checkout.resume('?tx_ref=from-query', { reference: 'explicit' });

    expect(seen).toEqual(['explicit']);
    expect(result.reference).toBe('explicit');
  });

  it('verifies the explicit reference even when the hint does not match', async () => {
    const fake = fakeWindow();
    const hints: CheckoutHint[] = [];
    const seen: string[] = [];
    const checkout = createCheckout({
      window: fake.window,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async (reference) => {
        seen.push(reference);
        return verified('succeeded');
      },
      onReturn: (hint) => hints.push(hint),
    });

    const result = await checkout.resume('?tx_ref=wrong', {
      reference: 'right',
      expectedReference: 'right',
    });

    expect(hints[0]?.reference).toBe('wrong');
    expect(hints[0]?.referenceMatches).toBe(false);
    expect(seen).toEqual(['right']);
    expect(result.reference).toBe('right');
    expect(result.outcome).toBe('succeeded');
  });

  it('never trusts the status hint over verification', async () => {
    const fake = fakeWindow();
    const checkout = createCheckout({
      window: fake.window,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async () => verified('failed'),
    });

    const result = await checkout.resume('?tx_ref=ref-9&status=success');

    expect(result.outcome).toBe('failed');
  });

  it('returns without verification when verify is not configured', async () => {
    const fake = fakeWindow();
    const events: string[] = [];
    const checkout = createCheckout({
      window: fake.window,
      onReturn: (hint) => events.push(`return:${hint.reference}`),
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.resume('?tx_ref=ref-8');

    expect(result.outcome).toBe('returned');
    expect(result.reference).toBe('ref-8');
    expect(result.payment).toBeNull();
    expect(events).toEqual(['return:ref-8', 'cancelled', 'close:returned']);
  });

  it('returns without verification when no reference is known', async () => {
    const fake = fakeWindow();
    let calls = 0;
    const events: string[] = [];
    const checkout = createCheckout({
      window: fake.window,
      pollIntervalMs: 1,
      pollTimeoutMs: 30,
      verify: async () => {
        calls += 1;
        return verified('succeeded');
      },
      onCancelled: () => events.push('cancelled'),
      onClose: (result) => events.push(`close:${result.outcome}`),
    });

    const result = await checkout.resume('https://app.example/thank-you?status=success');

    expect(result.outcome).toBe('returned');
    expect(result.reference).toBeNull();
    expect(calls).toBe(0);
    expect(events).toEqual(['cancelled', 'close:returned']);
  });
});
