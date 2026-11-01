<!-- @sdk-owner: A15-docs -->

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

## Getting started

### 1. Prerequisites

- Node.js 20 or newer (the SDK uses the built-in `fetch`). Bun works too.
- A MyIMO Pay merchant account. Staging credentials come from
  [app.demo.myimopay.com](https://app.demo.myimopay.com) → **Securities** →
  Public Key; live credentials from [app.myimopay.com](https://app.myimopay.com).
- The merchant **secret key** only if you create subaccounts or split
  settlement orders. Everything else works with the public key alone.

### 2. Install

```bash
bun add myimopay myimopay-browser
```

```bash
npm i myimopay myimopay-browser
```

### 3. Configure

Never hard-code keys. Read them from the environment:

```bash
MYIMOPAY_ENVIRONMENT=staging          # 'staging' or 'live' — no default
MYIMOPAY_PUBLIC_KEY=pk_staging_...    # sent as xp-key
MYIMOPAY_SECRET_KEY=sk_staging_...    # optional, sent as sp-key
MYIMOPAY_MAX_AMOUNT=5000              # optional guardrail, recommended in staging
```

```ts
import { MyImoPay } from 'myimopay';

const client = MyImoPay.fromEnv(process.env);
```

Or configure explicitly — both are equivalent, and anything can be overridden
later:

```ts
const client = new MyImoPay({
  environment: 'staging',
  publicKey: process.env.MYIMOPAY_PUBLIC_KEY!,
  maxAmount: 5000,
});
```

| Variable               | Required          | Purpose                                                   |
| ---------------------- | ----------------- | --------------------------------------------------------- |
| `MYIMOPAY_ENVIRONMENT` | unless `BASE_URL` | `staging` or `live`; selects the host                     |
| `MYIMOPAY_PUBLIC_KEY`  | yes               | Merchant public key, sent as `xp-key`                     |
| `MYIMOPAY_SECRET_KEY`  | no                | Secret key, sent as `sp-key` for subaccounts/split orders |
| `MYIMOPAY_BASE_URL`    | no                | Full https base URL; replaces the environment host        |
| `MYIMOPAY_TIMEOUT_MS`  | no                | Per-attempt timeout, default `20000`                      |
| `MYIMOPAY_MAX_AMOUNT`  | no                | Refuses any initiation above this amount                  |

### 4. Take your first payment

```ts
const payment = await client.payments.initiate({
  amount: 1500, // major units: ₦1,500.00 — not kobo
  customer: {
    fullName: 'Ada Obi',
    mobile: '08031234567', // normalised to +2348031234567
    email: 'ada@example.com', // required by default
  },
  callbackUrl: 'https://your-app.example/payments/return',
});

console.log(payment.reference); // <= 20 chars, the idempotency key
console.log(payment.authorizationUrl); // send the payer here
```

### 5. Confirm it worked

```ts
const verified = await client.payments.verify(payment.reference);

console.log(verified.status); // 'initiated' | 'pending' | 'succeeded' | 'failed' | 'expired'
console.log(verified.amountPaid); // what actually cleared
```

Grant value only when `status === 'succeeded'` (or `isPaid(verified)`). A
`pending` answer means "ask again later", never "unpaid".

## Usage

### Create a payment

| Field               | Required | Notes                                                                   |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| `amount`            | yes      | Major units, `> 0`, at most 2 decimals. Validated before any request.   |
| `customer.fullName` | yes      | Punctuation stripped and single words padded automatically.             |
| `customer.mobile`   | yes      | Nigerian number; `0803…`, `803…`, `+234803…` all accepted.              |
| `customer.email`    | yes      | Required unless you set `emailFallbackDomain` or `requireEmail: false`. |
| `reference`         | no       | Your id, `<= 20` chars. Generated when omitted; reuse it on retries.    |
| `callbackUrl`       | no       | Absolute https URL the payer returns to.                                |

```ts
const payment = await client.payments.initiate({
  amount: 1500,
  reference: `inv-${invoice.id}`, // sanitise long ids with sanitizeReference()
  customer: { fullName: 'Ada Obi', mobile: '08031234567', email: 'ada@example.com' },
});
```

Reference rules are the provider's, not ours: 20 characters, `[A-Za-z0-9._-]`,
and it doubles as the **idempotency key** — retrying the same reference never
creates a second payment. If your own id has slashes or is longer, pass it
through `sanitizeReference()` first; the SDK never rewrites it silently.

### Send the payer to checkout

Redirect (simplest) or popup (keeps your page alive):

```ts
// server: return payment.authorizationUrl to the client
return { url: payment.authorizationUrl, reference: payment.reference };
```

```ts
import { createCheckout } from 'myimopay-browser';

const checkout = createCheckout({
  mode: 'popup',
  verify: (reference) => fetch(`/api/payments/${reference}`).then((r) => r.json()),
  onSuccess: (paid) => router.push(`/receipt/${paid.reference}`),
  onCancelled: () => setStatus('Payment cancelled'),
  onClose: (result) => console.log(result.outcome),
});

await checkout.open(payment.authorizationUrl, { reference: payment.reference });
```

On the return page, `checkout.resume(window.location.href)` parses the query,
verifies through your endpoint and fires the same callbacks. The query string is
attacker-controlled, so `parseCheckoutResult` always reports `verified: false` —
the verdict comes from your server.

### React to a payment (server)

There is no polling API. Subscribe in the route that creates the payment, then
feed the verified webhook into the bus:

```ts
client.payments.events.on(
  payment.reference,
  {
    onSuccess: (event) => fulfil(event.reference),
    onFailed: (event) => release(event.reference),
    onExpired: (event) => release(event.reference),
    onClose: (outcome) => log.info({ outcome }), // succeeded | failed | expired | timeout | cancelled
  },
  { ttlMs: 30 * 60 * 1000 }, // default
);
```

A subscription is one in-memory entry: no timers, no polling, no background
work. Delivery happens once per reference, so a re-delivered webhook cannot
grant value twice. The bus is **per-process** — with several instances, route the
webhook to the instance holding the subscription, or persist the outcome and
reconcile from your own store.

### Webhook endpoint

MyIMO Pay does not sign deliveries. Read the raw body first, then either verify
your own HMAC proxy (`{ secret }`) or opt into the unsigned reality
(`{ allowUnsigned: true }`) and verify the payment before emitting:

```ts
import { assertRawBodyString, constructEvent, isPaid } from 'myimopay';

const rawBody = assertRawBodyString(req.body); // Buffer / await req.text()
const event = constructEvent(rawBody, req.header('x-myimopay-signature'), {
  allowUnsigned: true,
});

const payment = await client.payments.verify(event.reference);
if (!isPaid(payment)) return res.status(200).json({ received: true, ignored: payment.status });

await client.payments.events.emit(
  { ...event, status: payment.status },
  { allowUnverified: true },
);
res.status(200).json({ received: true });
```

The bus refuses an unverified event unless you pass `allowUnverified`, so a
forged POST cannot reach `onSuccess` on its own.

### Split payments

Requires the secret key and a settlement order (create one through the dashboard
or `client.settlementOrders.create`, whose percentages must total **less than
100%** — the merchant keeps the remainder):

```ts
const split = await client.payments.initiateSplit({
  amount: 5000,
  settlementOrderId: '6f1c…',
  customer: { fullName: 'Ada Obi', mobile: '08031234567', email: 'ada@example.com' },
});
```

### Read your data

```ts
const page = await client.transactions.filter({ page: 1, pageSize: 20, status: 'succeeded' });
const one = await client.transactions.findByReference('inv-1042'); // null when missing
const report = await client.settlements.directs({ fromDate: '2026-10-01', toDate: '2026-10-31' });
const account = await client.banks.resolve({ bankCode: '033', accountNumber: '0123456789' });
```

An empty result is `[]` or `null`, never an error. Subaccounts and settlement
orders live on `client.subaccounts` and `client.settlementOrders`.

### Override any option, at any time

```ts
client.baseUrl; // resolved host currently in effect
client.with({ maxAmount: 500 }); // derived client, original untouched
await client.payments.verify(reference, { timeoutMs: 5000, baseUrl: 'https://proxy.example' });
```

Config-level `baseUrl` wins over `environments`, which wins over the environment
default. `with({ environments: { staging: 'https://tunnel.example' } })` remaps a
host without changing what `environment` means.

### Handle errors

Every failure is a typed `MyImoPayError` with a stable `code`; nothing is a bare
string or a provider payload.

```ts
import { isMyImoPayError } from 'myimopay';

try {
  await client.payments.initiate(input);
} catch (error) {
  if (isMyImoPayError(error)) {
    switch (error.code) {
      case 'DUPLICATE_REFERENCE':
      case 'ALREADY_COMPLETED':
        return findExistingPayment(input.reference); // not a failure — it exists
      case 'VALIDATION_ERROR':
        return badRequest(error.message); // caught before the network
      case 'RATE_LIMITED':
        return retryLater();
      default:
        log.error(error.toJSON()); // redacted, safe to log
    }
  }
  throw error;
}
```

See [docs/errors.md](docs/errors.md) for every code, its HTTP counterpart and the
fix.

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
  verify the HMAC or verify the payment, emit the event into `payments.events`,
  and re-read the amount from your own records before granting value.
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
