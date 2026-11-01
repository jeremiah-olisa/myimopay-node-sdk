<!-- @sdk-owner: A13-docs -->

# Lifecycle contracts

Two lifecycles matter: the server-side payment event bus, and the browser-side
checkout. The webhook path is exactly-once per reference within a process, and
testable without a network.

## Server: `payments.events`

```ts
const unsubscribe = client.payments.events.on(reference, handlers, { ttlMs });
```

Subscribe in the route that creates the payment, before the payer is redirected.
The bus then waits: **no timer, no polling, no background work**. A subscription
is one in-memory entry and the bus is idle until `emit` is called.

```ts
// route that creates the payment
const unsubscribe = client.payments.events.on(payment.reference, {
  onSuccess: (event) => grantValue(event.reference),
  onFailed: (event) => releaseReservation(event.reference),
  onExpired: (event) => releaseReservation(event.reference),
  onClose: (outcome) => log.info({ outcome }),
});

// webhook route
const event = MyImoPay.webhooks.constructEvent(rawBody, signature, { secret });
// Unsigned (what the provider actually sends): { allowUnsigned: true }, then
// `payments.verify(event.reference)` before emitting.
await client.payments.events.emit(event);
```

### Firing order

```
on(reference, handlers)            one map entry, no timer
  └─ emit(event)
       ├─ non-terminal status (initiated | pending | unknown) ──► returns 0, subscription untouched
       ├─ no live subscription for that reference ──────────────► returns 0
       └─ terminal status (succeeded | failed | expired)
            ├─ onSuccess | onFailed | onExpired   (exactly one, or none if not supplied)
            └─ onClose(outcome)                   exactly once, always last
```

### Handlers

| Handler            | Fires                                           | Times              |
| ------------------ | ----------------------------------------------- | ------------------ |
| `onSuccess`        | A delivered `succeeded`                         | at most once       |
| `onFailed`         | A delivered `failed`                            | at most once       |
| `onExpired`        | A delivered `expired`                           | at most once       |
| `onClose(outcome)` | Terminal delivery, unsubscribe, TTL or eviction | exactly once, last |

`PaymentEventOutcome` is `'succeeded' | 'failed' | 'expired' | 'timeout' |
'cancelled'`:

- `succeeded` / `failed` / `expired` — the terminal delivery, after the matching
  handler.
- `cancelled` — `unsubscribe()` was called, or `clear()` closed the bus.
- `timeout` — the subscription's TTL elapsed, or it was the oldest subscription
  evicted at the `maxSubscriptions` cap.

Handlers may be async. Exceptions are **swallowed**: a throwing subscriber is
its own problem and must never fail the webhook response.

### Guarantees

- Only terminal statuses deliver. `initiated`, `pending` and `unknown` emit
  nothing and return `0`.
- Delivery is once per reference. A re-delivered webhook returns `0` and cannot
  grant value twice, because the subscription is dropped as it is delivered.
- Every live subscription for the reference is delivered to; `emit` returns the
  delivery count.
- `emit` validates that the event carries a non-empty reference and throws
  `VALIDATION_ERROR` otherwise. `on()` likewise rejects an empty reference, no
  handler, or a non-positive `ttlMs`.
- Defaults: TTL 30 minutes (`ttlMs`), at most 10 000 live subscriptions
  (`maxSubscriptions`, oldest evicted first). `createPaymentEventBus(options)`
  changes the defaults for a bus you own; `payments.events` uses the defaults.

### The bus is per-process

Subscriptions live in the process that created them. With more than one
instance — a cluster, several containers, serverless — the webhook may be
delivered to a process that never saw the subscription, and `emit` there returns
`0`. There is no cross-process delivery. Either route the webhook to the
subscribing instance (sticky sessions, or a queue keyed by reference), or persist
the outcome and reconcile from your own store.

If a payment's outcome must be known after the subscription has closed (the payer
walked away, or the process restarted), do that in your own worker: call
`payments.verify` on your own schedule. Reconciliation belongs in your job
scheduler, not in this library — a library that polls verification on your behalf
multiplies provider load and invites a self-inflicted denial of service.

### Signal, not proof of amount

`PaymentEvent` is `{ reference, providerReference, status, raw }`. It deliberately
does not carry a payable amount: a webhook body is attacker-reachable in
principle. Re-read the amount from your own records, or call `payments.verify`,
before granting value.

### Testable invariants

- Non-terminal `emit` returns `0` and leaves the subscription in place.
- A second terminal `emit` for the same reference returns `0`.
- `onClose` fires once, last, and its outcome matches the reason.
- `unsubscribe()` is idempotent: the second call does nothing.
- A throwing handler does not change `emit`'s return value or prevent `onClose`.
- An expired subscription delivers nothing and reports `timeout`.

## Browser: `createCheckout`

### Redirect flow

```
open(url, { reference })
  ├─ onOpen(url)                    1x
  ├─ window.location.assign(url)
  └─ onClose({ outcome: 'redirected', url, reference, payment: null })

… payer leaves, pays, comes back to callbackUrl …

resume(href, { reference?, expectedReference? })
  ├─ parseCheckoutResult(href) → hint   (hint.verified is false, always)
  ├─ onReturn(hint)                     1x, only from resume()
  ├─ no reference, or no verify configured
  │     └─ onCancelled() → onClose({ outcome: 'returned' })
  └─ verify configured
        └─ poll verify every pollIntervalMs until terminal or pollTimeoutMs
             ├─ succeeded ───► onSuccess(p)
             ├─ failed ──────► onFailed(p)
             ├─ expired ─────► onExpired(p)
             ├─ verify threw ► onError(error) ─► onClose({ outcome: 'error' })
             └─ poll gave up ► onCancelled() ─► onClose({ outcome: 'timeout' })
            …then onClose({ outcome, url, reference, payment })
```

The query string is the hint; the reference you verify is the one your page
already knows (`options.reference`, normally from session or storage).
`options.expectedReference`, when supplied, only controls
`hint.referenceMatches` — use it to decide whether to render the return page as
"this checkout" or as an unrelated navigation.

### Popup flow

```
open(url, { reference })
  ├─ window.open(url, target, popupFeatures) returns null ─► onBlocked(url) ─► onClose({ outcome: 'blocked' })
  ├─ onOpen(url)                    1x
  └─ popup closed or timeoutMs elapsed
       ├─ no reference, or no verify configured ─► onCancelled() ─► onClose({ outcome: 'closed' })
       ├─ timeoutMs elapsed ────────────────────► onCancelled() ─► onClose({ outcome: 'timeout' })
       └─ closed with verify configured ────────► verification takes over:
             ├─ verify → terminal ─► onSuccess | onFailed | onExpired ─► onClose
             ├─ verify threw ──────► onError ─► onClose({ outcome: 'error' })
             └─ pollTimeoutMs ─────► onCancelled() ─► onClose({ outcome: 'timeout' })
```

### Rules

| Rule                                                            | Consequence                                               |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| `onOpen` fires once                                             | It means "the page was opened or navigation started"      |
| `onReturn` fires only from `resume()`                           | `open()` never emits it                                   |
| Status callbacks need `verify`                                  | Without it, the checkout cannot know anything and says so |
| `resume()` resolves `'returned'` with no reference or no verify | The payer came back, but no conclusion is available       |
| `onCancelled` covers closed/timeout/returned                    | It is not an error                                        |
| `onError` means verification failed                             | Not "the payment failed"                                  |
| `onClose` always fires last, exactly once                       | No poll or listener survives it                           |
| `parseCheckoutResult().verified` is `false` forever             | A return URL is a hint, never proof                       |

`onCancelled` covers the non-terminal endings: a popup that goes away with no
reference or no `verify` resolves `'closed'`, `resume()` with nothing to verify
resolves `'returned'`, and a timeout resolves `'timeout'`.

`open()` and `resume()` **resolve** a `CheckoutResult` instead of throwing:
a popup blocker, a closed tab and a timeout are normal outcomes, not SDK
failures.

`CheckoutResult` is `{ outcome, url, reference, payment }` where `payment` is
non-null only for `succeeded` / `failed` / `expired` outcomes.

## Testing both

Use a fake `fetch` for the server, `events.emit` instead of sleeping, and a fake
`WindowLike` for the browser. Keep `pollIntervalMs` / `pollTimeoutMs` in
single-digit milliseconds and TTLs tiny. See [testing.md](testing.md).
