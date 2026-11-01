<!-- @sdk-owner: A13-docs -->

# `myimopay-browser` — checkout helpers

Keyless frontend helpers for MyIMO Pay: open the hosted payment page, read the
return URL, format amounts for display.

```bash
npm i myimopay-browser
```

**This package accepts no key, by design.** MyIMO Pay's integration guidance is
that the merchant key belongs on the server; a key in a bundle is on every
visitor's disk and in every cached copy, and cannot be rotated retroactively. So
`myimopay-browser` never initiates or verifies a payment itself — it opens a URL
and calls a function _you_ provide when it needs to know the outcome. That
function is normally your own endpoint wrapping `myimopay.payments.verify`.

## What the server does first

The browser receives two strings: the hosted checkout URL and the reference. Both
come from `myimopay` on your server. The server also subscribes to the payment's
events, because the webhook that settles it arrives there, not in the browser.

```ts
// Server route: POST /api/checkout
const payment = await client.payments.initiate({
  amount: order.amount,
  reference: order.reference, // <= 20 chars of [A-Za-z0-9._-]; the idempotency key
  customer: {
    fullName: order.customerName,
    mobile: order.customerMobile,
    email: order.customerEmail, // required by default
  },
  callbackUrl: 'https://shop.example/checkout/return',
});

// Subscribe before the payer is redirected, so no webhook arrives unheard.
client.payments.events.on(payment.reference, {
  onSuccess: async (event) => {
    const verified = await client.payments.verify(event.reference);
    if (verified.status === 'succeeded') await grantValue(verified.reference, verified.amountPaid);
  },
  onFailed: (event) => releaseReservation(event.reference),
  onExpired: (event) => releaseReservation(event.reference),
});

return { url: payment.authorizationUrl, reference: payment.reference };
```

`reference` is the provider's idempotency key: reuse it when retrying the same
payment, never for a different one. The event bus is per-process — with several
instances, route the webhook to the subscribing one or reconcile from your own
store. Details: [../../docs/lifecycle.md](../../docs/lifecycle.md).

## `createCheckout(options?)`

Returns a `Checkout` bound to one window and one mode.

| Option           | Type                                              | Default                 | Notes                                                                   |
| ---------------- | ------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `mode`           | `'redirect' \| 'popup'`                           | `'redirect'`            | `redirect` leaves the page; `popup` keeps it alive while the payer pays |
| `window`         | `WindowLike`                                      | the caller's own window | Injected so an iframe, an SSR pass or a test can drive the helper       |
| `timeoutMs`      | `number`                                          | `300000`                | How long a popup may stay open before resolving `timeout`               |
| `popupFeatures`  | `string`                                          | `width=480,height=720`  | Passed straight to `window.open`                                        |
| `verify`         | `(reference: string) => Promise<VerifiedPayment>` | `undefined`             | Your server call. Without it no status callback can ever fire           |
| `pollIntervalMs` | `number`                                          | `2000`                  | Verification cadence after the payer returns                            |
| `pollTimeoutMs`  | `number`                                          | `120000`                | How long to keep verifying before giving up                             |
| …handlers        | see below                                         | `undefined`             | Every callback is optional; supply only what you act on                 |

`WindowLike` is the only slice of `window` the package needs:

```ts
interface WindowLike {
  readonly closed: boolean;
  readonly location: { assign(url: string): void };
  open(url: string, target?: string, features?: string): WindowLike | null;
}
```

### Callbacks

| Callback             | Fires when                                                      | Times        |
| -------------------- | --------------------------------------------------------------- | ------------ |
| `onOpen(url)`        | The hosted page was opened, or navigation started               | once         |
| `onReturn(hint)`     | The payer came back to `callbackUrl` — **only from `resume()`** | 0..1         |
| `onBlocked(url)`     | A popup blocker stopped the checkout before it started          | 0..1         |
| `onSuccess(payment)` | `verify` returned `succeeded`                                   | 0..1         |
| `onFailed(payment)`  | `verify` returned `failed`                                      | 0..1         |
| `onExpired(payment)` | `verify` returned `expired`                                     | 0..1         |
| `onCancelled()`      | Closed, timed out, or returned with nothing to verify           | 0..1         |
| `onError(error)`     | `verify` threw                                                  | 0..1         |
| `onClose(result)`    | Always, last                                                    | exactly once |

`onSuccess`/`onFailed`/`onExpired` fire **only** when `verify` is configured.
The return URL is a hint, so the SDK refuses to guess a status from it.

`onClose` receives a `CheckoutResult`:

```ts
interface CheckoutResult {
  outcome:
    | 'redirected'
    | 'returned'
    | 'closed'
    | 'blocked'
    | 'timeout'
    | 'succeeded'
    | 'failed'
    | 'expired'
    | 'error';
  url: string; // the provider URL that was (or would have been) opened
  reference: string | null; // the reference that was verified, when one was known
  payment: VerifiedPayment | null; // present only for terminal, verified outcomes
}
```

`'returned'` is `resume()` with nothing to verify: the return URL carried no
reference and no `reference` option was passed, or no `verify` function was
configured. The payer came back, but no payment conclusion is available.
`onCancelled` covers the other non-terminal endings: a popup that goes away with
no reference or no `verify` resolves `'closed'`, and a timeout resolves
`'timeout'`.

`open()` and `resume()` **resolve** this object rather than throwing. A popup
blocker, a closed tab and a timeout are normal outcomes of a checkout, not SDK
failures.

## Redirect flow

```ts
import { createCheckout } from 'myimopay-browser';

const checkout = createCheckout({
  mode: 'redirect',
  onBlocked: (url) => showFallbackLink(url),
  onError: () => showRetry(),
});

// payment.authorizationUrl and payment.reference come from your server.
await checkout.open(payment.authorizationUrl, { reference: payment.reference });
// The page is leaving; `onClose` has already run with outcome 'redirected'.
```

On the return page, `resume()` does three things in order: parse the URL into a
hint, call `onReturn(hint)`, then — if a reference is known and `verify` is
configured — poll until a terminal status or `pollTimeoutMs`. With neither, it
resolves `'returned'` and fires `onCancelled`: the payer came back, but no
payment conclusion is available.

```ts
const checkout = createCheckout({
  verify: async (reference) => {
    const response = await fetch(`/api/payments/${encodeURIComponent(reference)}`);
    if (!response.ok) throw new Error('verification failed');
    return response.json(); // your endpoint wraps myimopay.payments.verify
  },
  onReturn: (hint) => {
    // hint.verified is false; render "confirming…", not "paid".
    analytics.track('checkout_returned', { reference: hint.reference, status: hint.statusHint });
  },
  onSuccess: (payment) => showReceipt(payment),
  onFailed: () => showFailure(),
  onExpired: () => showExpired(),
  onCancelled: () => showPending(),
  onError: () => showRetry(),
  onClose: (result) => finish(result.outcome),
});

await checkout.resume(window.location.href, {
  reference: storedReference, // from session/storage, not from the query string
  expectedReference: order.reference,
});
```

Pass `reference` because the query string is not authoritative. Pass
`expectedReference` when the page represents one specific order: it sets
`hint.referenceMatches`, which tells you whether the return even belongs to this
checkout.

## Popup flow

The merchant page stays alive, so you can keep state and show the result inline.

```ts
const checkout = createCheckout({
  mode: 'popup',
  popupFeatures: 'width=480,height=720',
  timeoutMs: 300_000,
  verify: verifyOnServer,
  onBlocked: (url) => {
    // Popup blocked: the payer still needs a way to pay.
    fallbackLink.href = url;
    fallbackLink.hidden = false;
  },
  onSuccess: (payment) => showReceipt(payment),
  onCancelled: () => showPending(),
  onClose: (result) => {
    if (result.outcome === 'blocked') return; // fallback link is already shown
    enablePayButton();
  },
});

const result = await checkout.open(payment.authorizationUrl, { reference: payment.reference });
```

A popup that the payer closes before a terminal status: with `verify` configured
the SDK starts verifying and continues until a terminal status or
`pollTimeoutMs`; without a reference or without `verify` it resolves `'closed'`
with `onCancelled`. A popup that outlives `timeoutMs` resolves `'timeout'`.
Neither `'closed'` nor `'timeout'` is an error, and neither means "unpaid".

## `parseCheckoutResult(search, options?)`

Reads a return query string — a bare `?a=b` or a full URL. Never throws.

```ts
import { parseCheckoutResult } from 'myimopay-browser';

const hint = parseCheckoutResult(window.location.search, { expectedReference: order.reference });
// { reference, statusHint, referenceMatches, rawQuery, verified: false }
```

| Field              | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `reference`        | The reference the query string claims, or `null`                   |
| `statusHint`       | The provider's raw status _word_ from the query string, if present |
| `referenceMatches` | `false` when `expectedReference` was supplied and does not match   |
| `rawQuery`         | Every key/value the provider put in the query string, untouched    |
| `verified`         | Always `false` in v1                                               |

Use it to decide what to _render_ (a spinner, "we could not find that payment"),
never what to _grant_.

## Formatting helpers

```ts
import { describePaymentStatus, formatAmount } from 'myimopay-browser';

formatAmount(1500.1); // '₦1,500.10'  (locale defaults to en-NG)
formatAmount(1500.1, 'USD', 'en-US'); // '$1,500.10'
describePaymentStatus('pending'); // payer-facing wording
```

`formatAmount(amount, currency?, locale?)` takes major units, like everywhere
else in this SDK. An unknown currency code or locale falls back to the code plus
a formatted number rather than throwing. `describePaymentStatus(status)` is copy,
not logic: never branch on its output to decide whether to grant value.

## React / Next.js example

```tsx
'use client';

import { createCheckout } from 'myimopay-browser';
import { useEffect, useState } from 'react';

/** Server-verified status. Never call the gateway from the browser. */
async function verifyOnServer(reference: string) {
  const response = await fetch(`/api/payments/${encodeURIComponent(reference)}`);
  if (!response.ok) throw new Error('verification failed');
  return response.json();
}

export function PayButton({ url, reference }: { url: string; reference: string }) {
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    const checkout = createCheckout({
      mode: 'redirect',
      verify: verifyOnServer,
      onError: () => setBusy(false),
      onClose: (result) => {
        if (result.outcome !== 'redirected') setBusy(false);
      },
    });
    await checkout.open(url, { reference });
  }

  return (
    <button type="button" onClick={pay} disabled={busy}>
      {busy ? 'Opening checkout…' : 'Pay now'}
    </button>
  );
}

export function ReturnPage({ reference }: { reference: string }) {
  const [message, setMessage] = useState('Confirming your payment…');

  useEffect(() => {
    const checkout = createCheckout({
      verify: verifyOnServer,
      onReturn: (hint) => {
        if (!hint.referenceMatches) setMessage('This link does not match your order.');
      },
      onSuccess: () => setMessage('Payment confirmed. Thank you.'),
      onFailed: () => setMessage('The payment did not go through.'),
      onExpired: () => setMessage('This payment link has expired.'),
      onCancelled: () => setMessage('Checkout closed. We are still checking this payment.'),
      onError: () => setMessage('We could not confirm the payment yet. Please refresh.'),
    });

    void checkout.resume(window.location.href, {
      reference,
      expectedReference: reference,
    });
  }, [reference]);

  return <p role="status">{message}</p>;
}
```

The `/api/payments/:reference` route is yours, runs on the server, and is the
only place `payments.verify` is called.

## The return URL is never proof of payment

`?status=success` is a string anyone can type. A payer can also close the tab,
bookmark the return page, or replay it a week later. Therefore:

- `parseCheckoutResult().verified` is `false` **by type**, and `onReturn` hands
  you a hint with that same flag.
- No status callback fires unless a `verify` function is configured, and that
  function must talk to your server.
- `CheckoutResult.payment` is non-null only for `succeeded`, `failed` and
  `expired` — all of which came back from `verify`.
- `outcome: 'redirected'` means "we sent the payer to the page". Nothing more.
- `outcome: 'returned'` means "the payer came back and there was nothing to
  verify": no reference was known, or no `verify` was configured.
- A `pending` verification is not a failed payment: keep showing "confirming",
  then let `pollTimeoutMs` expire and show a neutral message.

The same rule applies on the server: a webhook is a trigger, and
`payments.verify` is the proof.

## Related

- [../../docs/lifecycle.md](../../docs/lifecycle.md) — exact callback order for both flows.
- [../../docs/api.md](../../docs/api.md) — the server routes your `verify` endpoint wraps.
- [../../docs/security.md](../../docs/security.md) — why this package has no key.
- [../../examples/checkout-redirect.ts](../../examples/checkout-redirect.ts) and
  [../../examples/checkout-popup.ts](../../examples/checkout-popup.ts) — runnable snippets.
