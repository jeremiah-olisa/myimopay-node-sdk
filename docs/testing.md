<!-- @sdk-owner: A13-docs -->

# Testing an integration

The SDK has no hidden globals: `fetch` is injectable, `window` is injectable, and
the browser checkout's timers are configurable. That makes an integration
testable without a network and without a browser. The server event bus adds no
timers at all — you deliver to it with `emit`.

## Server: inject `fetch`

`MyImoPayConfig.fetch` accepts anything matching `FetchLike`:

```ts
type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: 'error' | 'follow' | 'manual';
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;
```

A request recorder is about twenty lines:

```ts
import { MyImoPay } from 'myimopay';

const calls: Array<{ url: string; method: string; body: unknown }> = [];

const client = new MyImoPay({
  environment: 'staging',
  publicKey: 'pk_test_1234567890',
  fetch: async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          header: { is_success: true },
          data: {
            tx_reference: 'ref-1',
            status: 2,
            is_settled: true,
            paid_amount: '1500.00',
            currency: 'NGN',
          },
        }),
    };
  },
});

const verified = await client.payments.verify('ref-1');
// verified.status === 'succeeded'
```

Assert on the request, not only the response: the exact path
(`/vi/pay/verify/ref-1`), the method, and — for `initiate` — the wire body
(`amount` is a fixed-point **string**, `customer_mobile` is E.164).

Useful cases worth a test each:

| Case                             | What to return                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Success envelope                 | `{ header: { is_success: true }, data: { … } }`                                                      |
| Provider failure inside HTTP 200 | `{ header: { is_success: false, remark: 'already initiated' }, data: null }` → `DUPLICATE_REFERENCE` |
| Empty settlement read            | `404`, or `200` with `data: null` → `[]` / `null`                                                    |
| Missing transaction              | `404` → `findByReference`/`findById` resolve to `null`                                               |
| Empty body / non-JSON            | `text: async () => ''` / `text: async () => 'oops'` → `MALFORMED_RESPONSE`                           |
| Retry then success               | throw on the first call, succeed on the second                                                       |
| Rate limit                       | `429` with a `retry-after: 0` header                                                                 |

Because retries are on by default (3 attempts), a fake that always fails must be
asserted against **call count**, and a test of failure needs a small
`retry: { attempts: 1 }` unless it is testing the retry itself. Only `GET` and
writes marked `retryableWrite` (payment initiation) are retried.

## Server: the event bus, without timers

There is nothing to wait for: `events.emit` delivers synchronously (handlers may
be async, and `emit` awaits them). A fake `fetch` is not even needed unless the
subscriber verifies.

```ts
const seen: string[] = [];
const unsubscribe = client.payments.events.on('ref-1', {
  onSuccess: (event) => void seen.push(`success:${event.reference}`),
  onClose: (outcome) => void seen.push(`close:${outcome}`),
});

const delivered = await client.payments.events.emit({
  reference: 'ref-1',
  providerReference: 'prov-1',
  status: 'succeeded',
  raw: null,
});

expect(delivered).toBe(1);
expect(seen).toEqual(['success:ref-1', 'close:succeeded']);
unsubscribe();
```

Cases worth a test each:

| Case                                 | Expectation                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `pending` / `initiated` / `unknown`  | `emit` returns `0`; `size` is unchanged; no handler fires                       |
| Second `succeeded` for one reference | `emit` returns `0`; the success handler ran once                                |
| `unsubscribe()` twice                | `onClose('cancelled')` once; `size` is 0                                        |
| TTL expiry                           | `{ ttlMs: 1 }` plus a short sleep → `onClose('timeout')`, `size` 0              |
| Cap eviction                         | `createPaymentEventBus({ maxSubscriptions: 1 })` → oldest closes with `timeout` |
| Throwing subscriber                  | `emit` still returns `1` and `onClose` still runs                               |

Never assert on wall-clock polling; there is none. If you do keep a reconciliation
job of your own, test it with an injected `fetch`, not by sleeping.

## Server: webhooks without a body parser

Sign with the same helper the handler verifies with:

```ts
import { constructEvent, signWebhookPayload } from 'myimopay';

const body = JSON.stringify({ data: { tx_reference: 'ref-1', status: 2, is_settled: true } });
const signature = signWebhookPayload(body, 'whsec_test');
const event = constructEvent(body, signature, { secret: 'whsec_test' });

// Then hand it to the bus exactly as the route does:
const delivered = await client.payments.events.emit(event);
expect(delivered).toBe(1);
```

Test the rejects too: a tampered body, a missing signature, an empty secret, and
a body that is valid JSON but has no `tx_reference`. All of them must throw
`MyImoPayWebhookError` (code `WEBHOOK_SIGNATURE_INVALID`) — a delivery must never
be processed on the strength of shape alone.

If you test an Express handler, use `express.raw({ type: 'application/json' })`
(or `supertest`'s `.send(Buffer.from(body))`) so the bytes the handler reads are
the bytes you signed.

## Browser: fake `WindowLike`

`createCheckout({ window })` takes the slice of `window` it needs, so no DOM is
required:

```ts
const opened: string[] = [];
const fakeWindow = {
  closed: false,
  location: { assign: (url: string) => opened.push(url) },
  open: (url: string) => {
    opened.push(url);
    return fakeWindow; // returning null simulates a popup blocker
  },
};
```

Return `null` from `open` to exercise `onBlocked` + `outcome: 'blocked'`. Flip
`closed` to `true` to exercise the popup path: with `verify` configured that
starts verification; without a reference or without `verify` it resolves
`'closed'`. Leave `verify` undefined to assert that **no** status callback fires
and the result carries `payment: null`; `resume()` with no reference then
resolves `'returned'`.

Keep `pollIntervalMs` and `pollTimeoutMs` in the low milliseconds. Assert the
callback order (`onOpen` → terminal → `onClose`) and that `onClose` ran exactly
once, not just that the final outcome was right.

For the return page, `parseCheckoutResult` is pure: feed it `?a=b` strings and
assert `rawQuery`, `reference`, `statusHint`, `referenceMatches` and that
`verified` is always `false`.

## `MYIMOPAY_SMOKE=1` is opt-in, and never in CI

Live smoke tests exist because a mock cannot prove that the provider still
accepts the payload we send. They are gated behind `MYIMOPAY_SMOKE=1` because
MyIMO Pay's integration instructions state that **staging transactions move real
money**: a smoke run initiates a real payment, and a "test" card does not exist
to make it free. Treat staging as production until the provider confirms
otherwise, and re-check that claim before a test run. Consequences:

- `MYIMOPAY_SMOKE` must never be set in a CI job, a preview environment, a cron
  or a deploy hook. CI runs the mocked suite only.
- A smoke run needs `MYIMOPAY_ENVIRONMENT=staging`, real staging keys, and a
  deliberately small `maxAmount`, and it must never point at `live`.
- Treat the run as a manual release step: run it, read the output, then clean up
  whatever it created.

If a workflow ever sets that variable, that is a bug in the workflow, not a
convenience.

## Packed-tarball smoke

Unit tests run against `src`; consumers install `dist`. `bun run check:pack`
(`scripts/verify-tarball.ts`) closes that gap: it packs the publishable
tarballs with `npm pack`, installs them into a throwaway project, and imports
both packages the way a consumer would — including the CJS entry point and the
`types` condition.

To do the same by hand:

```bash
npm pack ./packages/node ./packages/browser
mkdir /tmp/consumer && cd /tmp/consumer && npm init -y
npm i /path/to/myimopay-0.1.0.tgz /path/to/myimopay-browser-0.1.0.tgz
node -e "const { MyImoPay } = require('myimopay'); console.log(typeof MyImoPay)"
node --input-type=module -e "import { createCheckout } from 'myimopay-browser'; console.log(typeof createCheckout)"
```

A failure here usually means a missing `dist` file, a broken `exports` map or a
type declaration that does not resolve — none of which a `src`-level test can
catch. The whole gate is `bun run verify`; see `CONTRIBUTING.md`.
