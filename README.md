# MyIMO Pay TypeScript SDK

Two packages, one contract, zero runtime dependencies.

| Package                                | Runs in           | Holds a key | What it does                                                                                 |
| -------------------------------------- | ----------------- | ----------- | -------------------------------------------------------------------------------------------- |
| [`myimopay`](packages/node)            | Node 20+ (server) | Yes         | Initiate, verify, list transactions, settlement reports, subaccounts, split orders, webhooks |
| [`myimopay-browser`](packages/browser) | Any browser       | **Never**   | Open the hosted checkout, read the return query string, format amounts                       |

Both packages are ESM + CJS, ship their own types, and share every model and
error through `@myimopay/core` (private, bundled into both).

## Install

```bash
bun add myimopay
bun add myimopay-browser
```

## Server quickstart

```ts
import { MyImoPay } from 'myimopay';

// Reads MYIMOPAY_ENVIRONMENT, MYIMOPAY_PUBLIC_KEY, MYIMOPAY_SECRET_KEY.
const client = MyImoPay.fromEnv(process.env);
const payment = await client.payments.initiate({
  amount: 1500,
  customer: { fullName: 'Ada Obi', mobile: '08031234567' },
});
const verified = await client.payments.verify(payment.reference);
if (verified.status === 'succeeded') {
  /* grant value */
}
```

## Browser quickstart

```ts
import { createCheckout } from 'myimopay-browser';

const checkout = createCheckout({ mode: 'popup' });
await checkout.open(payment.authorizationUrl);
```

## Read this before you deploy

- **Staging moves real money.** `environment: 'staging'` is not a sandbox. Set
  `maxAmount` on every non-production client.
- **Never put your key in a browser.** `myimopay` throws on import in a browser
  bundle by design. The browser package is keyless and cannot charge anyone on
  its own; only your server can verify a payment.
- **A checkout return is not proof.** `parseCheckoutResult` always reports
  `verified: false`. Call `payments.verify` on the server.

## Docs

- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — the frozen public surface.
- [`docs/provider-notes.md`](docs/provider-notes.md) — observed provider quirks
  and where the API departs from its own documentation.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the `bun run verify` gate.
- [`SECURITY.md`](SECURITY.md) — disclosure policy and key handling.
