<!-- @sdk-owner: A13-docs -->

# MyIMO Pay TypeScript SDK

Unofficial, dependency-free TypeScript client for the MyIMO Pay payment gateway.
It wraps the provider's `{ header, data }` envelope, normalises snake_case
payloads and mixed number/string fields into typed models, and makes the awkward
parts explicit: verification is eventually consistent, `tx_ref` is both an id and
an idempotency key, and the browser must never see a merchant key.

| Package                                | Runs in           | Holds a key | What it does                                                                                                                      |
| -------------------------------------- | ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`myimopay`](packages/node)            | Node 20+ (server) | Yes         | Initiate and verify payments, payment events, transaction history, settlement reports, banks, subaccounts, split orders, webhooks |
| [`myimopay-browser`](packages/browser) | Any browser       | **Never**   | Open the hosted checkout, read the return query string, format amounts                                                            |

Both packages are ESM + CJS, ship their own types, and share every model and
error class through `@myimopay/core` (private, bundled into both — never install
it directly). Runtime dependencies: none.

**Why the browser package is keyless.** MyIMO Pay's own integration guidance is
that the merchant key belongs on the server: a key compiled into a frontend
bundle is on every visitor's disk and in every cached CDN copy, and it cannot be
rotated retroactively for sessions already running. So `myimopay-browser`
accepts no key at all — it opens a URL and formats numbers, and it asks _your_
endpoint when it needs to know whether a payment succeeded. `myimopay` refuses
to load in a browser by design.

## Install

```bash
bun add myimopay
```

```bash
npm i myimopay myimopay-browser
```

`myimopay` needs Node 20 or newer (it uses the built-in `fetch`) and no runtime
dependencies.

## Server quickstart

```ts
import { MyImoPay } from 'myimopay';

const client = MyImoPay.fromEnv(process.env); // MYIMOPAY_ENVIRONMENT, MYIMOPAY_PUBLIC_KEY, MYIMOPAY_SECRET_KEY
const customer = {
  fullName: 'Ada Obi',
  mobile: '08031234567',
  email: 'ada@example.com', // required by default: the provider rejects initiations without one
};
const payment = await client.payments.initiate({ amount: 1500, customer });
const verified = await client.payments.verify(payment.reference); // 'succeeded' means paid
```

Send the payer to `payment.authorizationUrl`. `environment` is required and has
no default: guessing it is how a staging build ends up billing a live account.

`reference` (or `payment.reference`) is the provider's **idempotency key**: at
most 20 characters of `[A-Za-z0-9._-]`, validated locally. Reuse it when retrying
the same payment, never for a different one. `client.reference(seed?)` always
fits.

The server SDK has no polling API. Subscribe to the payment's events in the route
that creates it, then emit the verified webhook into the bus:

```ts
// route that creates the payment
const unsubscribe = client.payments.events.on(payment.reference, {
  onSuccess: (event) => grantValue(event.reference),
  onFailed: (event) => releaseReservation(event.reference),
  onExpired: (event) => releaseReservation(event.reference),
  onClose: (outcome) => log.info({ outcome }), // succeeded | failed | expired | timeout | cancelled
});

// webhook route
const event = MyImoPay.webhooks.constructEvent(rawBody, signature, { secret });
await client.payments.events.emit(event);
```

A subscription is one in-memory entry: no timers, no background work. Only
terminal statuses deliver, delivery happens once per reference, and `onClose`
fires exactly once and last. The bus is **per-process** — with several instances
the webhook may land on a process holding no subscription, so route the delivery
to the subscribing instance or persist the outcome and reconcile from your own
store. See [docs/lifecycle.md](docs/lifecycle.md).

## Browser quickstart

```ts
import { createCheckout } from 'myimopay-browser';

const verify = (reference: string) => fetch(`/api/payments/${reference}`).then((r) => r.json());
const checkout = createCheckout({ mode: 'redirect', verify });
await checkout.open(payment.authorizationUrl, { reference: payment.reference });
```

`resume(href)` is the return-page counterpart of `open()`; with no reference or no
`verify` it resolves `outcome: 'returned'`. See
[docs/lifecycle.md](docs/lifecycle.md).

## Read this before you deploy

> **Staging moves real money.** MyIMO Pay's integration instructions state that
> staging transactions move real money. `environment: 'staging'` is not a
> sandbox — it points at `https://apipg.demo.myimopay.com` and payments there are
> real. Treat staging as production until the provider confirms otherwise, and
> re-check before a test run. Set `maxAmount` on every non-production client so a
> bug cannot charge a real amount, and never point a smoke test at `live`.

- **Never log or commit keys.** Read them from the environment
  (`MyImoPay.fromEnv(process.env)`), keep `.env` git-ignored, and log
  `error.toJSON()` rather than raw headers or provider bodies. Error objects and
  debug events are redacted before they leave the SDK; your own logs are not.
- **Never put a key in a browser bundle.** No `NEXT_PUBLIC_*` key, no
  client-side `verify`, no mobile app key. If a frontend needs a payment check,
  it calls your server.
- **A checkout return is not proof.** `parseCheckoutResult` reports
  `verified: false` forever; the query string is attacker-controlled.
- **A webhook is a trigger, not proof.** It is not even signed by the provider —
  verify the HMAC, emit the event into `payments.events`, and re-read the amount
  from your own records (or `payments.verify`) before granting value.
- **A non-terminal verify means "ask again later".** `pending` is never `unpaid`,
  and `is_settled: true` beats a contradictory integer status.

## Docs

- [docs/api.md](docs/api.md) — every resource, route, parameter, model and thrown error.
- [docs/errors.md](docs/errors.md) — the full error catalogue and what to do about each code.
- [docs/security.md](docs/security.md) — key handling, header model, redaction, webhook verification.
- [docs/lifecycle.md](docs/lifecycle.md) — event-bus guarantees and the browser checkout contract.
- [docs/testing.md](docs/testing.md) — mocking `fetch`, faking windows, and why `MYIMOPAY_SMOKE` stays out of CI.
- [packages/node/README.md](packages/node/README.md) — the full server reference.
- [packages/browser/README.md](packages/browser/README.md) — checkout flows and the return page.
- [docs/CONTRACTS.md](docs/CONTRACTS.md) — the frozen public surface.
- [docs/provider-notes.md](docs/provider-notes.md) — where the provider departs from its own documentation.
- [examples/](examples) — dependency-free webhook, event-bus, redirect and popup snippets.
- [SECURITY.md](SECURITY.md) — vulnerability disclosure.
- [CONTRIBUTING.md](CONTRIBUTING.md) — the `bun run verify` gate.
