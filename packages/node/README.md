<!-- @sdk-owner: A13-docs -->

# `myimopay` — server SDK

Node 20+ client for the MyIMO Pay gateway. Zero runtime dependencies, ESM + CJS,
types included, every model carrying the untouched `raw` payload.

```bash
npm i myimopay
```

```ts
import { MyImoPay } from 'myimopay';

const client = new MyImoPay({
  environment: 'staging',
  publicKey: process.env.MYIMOPAY_PUBLIC_KEY ?? '',
  secretKey: process.env.MYIMOPAY_SECRET_KEY, // needed for subaccounts and split orders
  maxAmount: 5000, // staging is not a sandbox
});
```

There is no `environment` default on purpose: guessing it is how a staging build
ends up billing a live account. MyIMO Pay's integration instructions state that
staging transactions move real money: treat staging as production until the
provider confirms otherwise, and re-check before a test run. `myimopay` is
server-only and throws `SERVER_ONLY` when loaded through the `browser` export
condition or constructed where `globalThis.window` exists.

## Configuration

`new MyImoPay(config)` validates everything once, in the constructor, and fails
with `INVALID_CONFIG` naming the field and the rule — never the value of a key.

| Option                         | Type                          | Default                              | Why / rule                                                                                                                                                                                      |
| ------------------------------ | ----------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment`                  | `'staging' \| 'live'`         | **required unless `baseUrl`**        | Selects the default host. No default, so nobody silently bills a live account. Staging still moves real money per the provider's integration instructions                                       |
| `environments`                 | `{ staging?, live? }`         | `DEFAULT_BASE_URLS`                  | Remaps a provider host per environment (tunnel, proxy, provider host change) without changing what `environment` means. `baseUrl` still wins                                                    |
| `publicKey`                    | `string`                      | **required**                         | Trimmed; at least 8 characters. Sent as `xp-key`                                                                                                                                                |
| `secretKey`                    | `string`                      | `undefined`                          | Needed for subaccounts and settlement orders; sent as `sp-key`. Non-empty when provided                                                                                                         |
| `baseUrl`                      | `string`                      | `DEFAULT_BASE_URLS[environment]`     | Absolute https URL, no embedded credentials. For proxies, mock servers and self-hosted gateways only                                                                                            |
| `timeoutMs`                    | `number`                      | `20000`                              | Per **attempt**. Must be `> 0` and `<= 120000`                                                                                                                                                  |
| `retry.attempts`               | `number`                      | `3`                                  | Total attempts including the first; integer `1..10`                                                                                                                                             |
| `retry.baseDelayMs`            | `number`                      | `300`                                | Base backoff; integer `1..10000`                                                                                                                                                                |
| `retry.maxDelayMs`             | `number`                      | `5000` (or `baseDelayMs`, if larger) | Hard ceiling for any wait, including a provider `retry-after`; must be `>= baseDelayMs`                                                                                                         |
| `headers`                      | `Record<string, string>`      | `{}`                                 | Extra headers on every request. Names must be lowercase `[a-z0-9-]`; no line breaks; `host`, `content-length`, `content-type` and `authorization` are rejected                                  |
| `publicKeyHeader`              | `string`                      | `'xp-key'`                           | Lowercase header name; for deployments where the provider moves the credential                                                                                                                  |
| `secretKeyHeader`              | `string`                      | `'sp-key'`                           | Same, for the secret key                                                                                                                                                                        |
| `fetch`                        | `FetchLike`                   | `globalThis.fetch`                   | Injectable for tests, proxies and instrumented runtimes. Missing global `fetch` is `INVALID_CONFIG`                                                                                             |
| `onDebug`                      | `(event: DebugEvent) => void` | `undefined`                          | Structured, pre-redacted diagnostics. There is no console fallback, and a throwing hook is swallowed                                                                                            |
| `maxAmount`                    | `number`                      | `undefined`                          | Refuses any initiation above this amount, in major units, before the network call. `> 0`, `<= 1e9`                                                                                              |
| `customer.sanitizeName`        | `boolean`                     | `true`                               | Repairs `customer.fullName` into something the provider accepts: ASCII, no punctuation, lone one-letter words merged, single word padded. `false` sends it verbatim (whitespace collapsed only) |
| `customer.requireEmail`        | `boolean`                     | `true`                               | The provider rejects initiations without `customer_email` in practice, so a missing email fails locally with `VALIDATION_ERROR` before the payer is redirected. `false` omits the field         |
| `customer.emailFallbackDomain` | `string`                      | `undefined`                          | When set, a missing email becomes `<phone>@domain` (USSD/POS flows). Off by default: fabricating an address is a product decision. Must be a bare domain                                        |

Default hosts:

| Environment | Base URL                          |
| ----------- | --------------------------------- |
| `staging`   | `https://apipg.demo.myimopay.com` |
| `live`      | `https://api.myimopay.com`        |

`DEFAULT_BASE_URLS` is exported if you need to compare against it.

### Customer fields

Three options under `customer` control what reaches the wire. All are opt-out,
so a caller that already normalises its own data keeps full control:

```ts
const client = new MyImoPay({
  environment: 'staging',
  publicKey,
  customer: {
    sanitizeName: true, // default
    requireEmail: true, // default
    emailFallbackDomain: 'payments.example.com', // unset by default
  },
});
```

`sanitizeName` runs `sanitizeCustomerName` over `customer.fullName`: accents and
punctuation are folded to ASCII (`"O'Brien-Okafor  Chinedu!"` →
`"OBrien Okafor Chinedu"`), a lone one-letter word is merged into its neighbour
(`"H careplus"` → `"Hcareplus"`), a single-word name is padded
(`"Techcourt"` → `"Techcourt Customer"`), and a name with nothing usable becomes
`"Valued Customer"`. The provider rejects all three shapes in production even
though its schema does not say so. Set `false` to send the name verbatim after
whitespace collapsing — only after your own normalisation.

`requireEmail` defaults to `true` because the provider rejects initiations
without `customer_email` in practice. A missing email therefore fails **locally**,
with `field: 'customer.email'` and this message, before the payer is redirected:

```text
customer.email is required: MyIMO Pay rejects initiations without one in practice. Pass customer.email, set customer.emailFallbackDomain to derive one from the phone, or set customer.requireEmail to false if you have verified your flow needs none.
```

`emailFallbackDomain` derives `<phone>@domain` for flows with no email at all
(USSD, POS). It is off by default because fabricating an address is a product
decision. With it set, `mobile: '08031234567'` and
`emailFallbackDomain: 'payments.example.com'` send
`customer_email: '08031234567@payments.example.com'`.

Email values are trimmed; `undefined`, `null`, `""` and whitespace all count as
missing; a malformed address throws `VALIDATION_ERROR` (`customer.email is not a
valid email address.`) before any network call.

## Overriding anything, at any time

Nothing is locked at construction time. From coarsest to finest:

1. **`environment`** picks the default host (or `environments` remaps it).
2. **`baseUrl`** replaces that host for the whole client, and is all you need if you do not want an environment at all.
3. **`client.with({ ... })`** derives a new client with _any_ option overridden —
   keys, timeout, retry, headers, guardrails. The original is untouched.
4. **`RequestOptions`** as the last argument of every resource method overrides
   `baseUrl`, `timeoutMs` and `headers` for a single call.

```ts
const staging = new MyImoPay({ environment: 'staging', publicKey, maxAmount: 1000 });

const replaying = staging.with({ baseUrl: 'https://replay.internal', timeoutMs: 5000 });
const live = staging.with({ environment: 'live', publicKey: liveKey, secretKey: liveSecret });

await client.payments.verify(reference, { timeoutMs: 60_000, signal: controller.signal });
```

`with()` ignores `undefined` values, so `{ timeoutMs: undefined }` does not erase
the existing timeout. Credentials are the one thing that never travels per call:
`RequestOptions` has no key field.

Two header-precedence details are worth knowing:

- Client `headers` are applied **after** per-call `headers`, so on a name clash
  the client wins. Use one or the other per name.
- Per-call `headers` are validated like config headers: a credential name
  (`xp-key`, `sp-key` and their overrides), `host`, `content-length`,
  `content-type`, `authorization`, `connection`, `transfer-encoding`, `cookie`
  or `set-cookie` is rejected with `VALIDATION_ERROR`. The config-level
  `headers` option rejects the smaller set `host`, `content-length`,
  `content-type` and `authorization`. Credentials are written last in every
  case, so nothing can overwrite them.

## Resources

Every call method takes `RequestOptions` last: `{ signal?, timeoutMs?,
headers?, baseUrl? }`. `client.payments.events` is not a call method — it is the
event bus described under [Lifecycle](#lifecycle-paymentsevents).

### `client.payments`

`amount` is major units (`1500` = ₦1,500.00), never kobo.

```ts
initiate(input: InitiatePaymentInput, options?: RequestOptions): Promise<PaymentInitiation>
initiateSplit(input: InitiateSplitPaymentInput, options?: RequestOptions): Promise<PaymentInitiation>
verify(reference: string, options?: RequestOptions): Promise<VerifiedPayment>
verifyById(id: string, options?: RequestOptions): Promise<VerifiedPayment>
readonly events: PaymentEventBus
```

`initiate` is `POST /vi/pay/initiate` with the public key; `initiateSplit` is
`POST /vi/pay/initiate/split` and also sends `sp-key`. Both are retried on
failure because `tx_ref` is the provider's de-duplication key.

### `client.transactions`

```ts
list(options?: RequestOptions): Promise<Transaction[]>
filter(query?: TransactionQuery, options?: RequestOptions): Promise<TransactionPage>
findByReference(reference: string, options?: RequestOptions): Promise<Transaction | null>
findById(identifier: string, options?: RequestOptions): Promise<Transaction | null>
summary(range?: DateRangeQuery, options?: RequestOptions): Promise<ProviderRecord>
statusCounts(options?: RequestOptions): Promise<ProviderRecord>
analytics(days?: number, options?: RequestOptions): Promise<ProviderRecord>
```

Read-only, public key. `findByReference`/`findById` resolve to `null` on 404.

### `client.settlements`

```ts
directs(query?: SettlementQuery, options?: RequestOptions): Promise<DirectSettlement[]>
splits(query?: SettlementQuery, options?: RequestOptions): Promise<SplitSettlement[]>
directByReference(reference: string, options?: RequestOptions): Promise<DirectSettlement | null>
splitByReference(reference: string, options?: RequestOptions): Promise<SplitSettlement | null>
splitByOrder(settlementOrderId: string, options?: RequestOptions): Promise<SplitSettlement[]>
```

Date windows are all-or-nothing: both `fromDate` and `toDate`, or neither.

### `client.banks`

```ts
list(countryCode: string, options?: RequestOptions): Promise<Bank[]>
resolve(input: { bankCode: string; accountNumber: string }, options?: RequestOptions): Promise<BankAccount>
```

`resolve` validates both values as letters/digits only before they reach the URL.

### `client.subaccounts`

```ts
list(options?: RequestOptions): Promise<Subaccount[]>
get(id: string, options?: RequestOptions): Promise<Subaccount>
create(input: CreateSubaccountInput, options?: RequestOptions): Promise<Subaccount>
```

Requires `secretKey`. `accountNumber` must be a 10-digit NUBAN. `create` is not
auto-retried — pass your own `identifier` so a manual retry is idempotent.

### `client.settlementOrders`

```ts
list(options?: RequestOptions): Promise<SettlementOrder[]>
get(id: string, options?: RequestOptions): Promise<SettlementOrder>
create(input: CreateSettlementOrderInput, options?: RequestOptions): Promise<SettlementOrder>
update(id: string, input: CreateSettlementOrderInput, options?: RequestOptions): Promise<SettlementOrder>
```

Requires `secretKey`. Percentages must total strictly less than 100%, and a
subaccount may not appear twice. `create` and `update` are not auto-retried.

### Client members

| Member               | Signature                                                        | Notes                                            |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| `client.reference`   | `(seed?: string) => string`                                      | Always fits 20 characters                        |
| `client.environment` | `get environment(): 'staging' \| 'live'`                         | Never a secret                                   |
| `client.baseUrl`     | `get baseUrl(): string`                                          | Exactly what was configured, no re-serialisation |
| `client.with`        | `(overrides: Partial<MyImoPayConfig>) => MyImoPay`               | Derives; never mutates                           |
| `MyImoPay.fromEnv`   | `(env?: EnvLike) => MyImoPay`                                    | See below                                        |
| `MyImoPay.webhooks`  | `{ constructEvent, verifyWebhookSignature, signWebhookPayload }` | Also exported top-level                          |
| `createClient`       | `(config: MyImoPayConfig) => MyImoPay`                           | Functional alias                                 |

## Lifecycle: `payments.events`

The server SDK has no polling API. `payments.watch` was removed: a library that
polls `verify` for you multiplies provider load and invites a self-inflicted
denial of service, so reconciliation belongs in your own job scheduler. The
lifecycle is event-based instead — subscribe in the route that creates the
payment, emit from the webhook route.

```ts
// Route that creates the payment, before the payer is redirected.
const unsubscribe = client.payments.events.on(payment.reference, {
  onSuccess: async (event) => {
    // The event is a signal, not proof of amount: re-read it.
    const verified = await client.payments.verify(event.reference);
    if (verified.status === 'succeeded') await grantValue(verified.reference, verified.amountPaid);
  },
  onFailed: (event) => releaseReservation(event.reference),
  onExpired: (event) => releaseReservation(event.reference),
  // succeeded | failed | expired | timeout | cancelled
  onClose: (outcome) => log.info({ outcome }),
});

// Webhook route: authenticated delivery, then delivery to the subscriber.
const event = MyImoPay.webhooks.constructEvent(rawBody, signature, { secret });
const delivered = await client.payments.events.emit(event);

// Shutdown, or the payer abandoned checkout:
unsubscribe();
```

- **A subscription is one in-memory entry.** No timers, no polling, no background
  work: the bus is idle until `emit`.
- **Only terminal statuses deliver.** `succeeded`, `failed` and `expired` fire a
  handler; `initiated`, `pending` and `unknown` emit nothing and return `0`.
- **Once per reference.** The subscription is dropped as it delivers, so a
  re-delivered webhook returns `0` and cannot grant value twice. Every live
  subscriber for that reference is delivered to; `emit` returns the count.
- **`onClose` fires exactly once, always last.** Its outcome is the terminal
  status, `cancelled` (from `unsubscribe()` or `clear()`), or `timeout` (TTL
  expiry or cap eviction).
- **Defaults:** TTL 30 minutes, at most 10 000 live subscriptions.
  `createPaymentEventBus({ ttlMs, maxSubscriptions })` is exported if you own the
  bus; `payments.events` uses the defaults.
- **Handler exceptions are swallowed.** A throwing subscriber never fails a
  webhook response.
- **The bus is per-process.** With several instances the webhook can land on a
  process holding no subscription, and `emit` there returns `0`. Route the
  delivery to the subscribing instance, or persist the outcome and reconcile from
  your own store. There is no cross-process delivery.
- **The event is not a ledger.** It carries the reference and terminal status,
  never a payable amount. Re-read the amount from your own records (or
  `payments.verify`) before granting value.

If you must poll, do it in your own worker: call `payments.verify` on your own
schedule and keep the retry policy in your job scheduler, not in this library.

## Webhooks

MyIMO Pay does **not** sign deliveries, so there is nothing provider-issued to
verify. Read the raw body first (before any JSON parsing), then choose one mode
explicitly — there is no default:

- **Signed** — you put a HMAC proxy in front of the endpoint and pass
  `{ secret }`. `event.verified` is `true`.
- **Unsigned** — the provider's real behaviour: pass `{ allowUnsigned: true }`.
  `event.verified` is `false`, and the SDK **refuses to emit it** until you have
  verified the payment yourself.

```ts
import { assertRawBodyString, constructEvent, isPaid } from 'myimopay';

const rawBody = assertRawBodyString(req.body); // Buffer, or await req.text()
const signature = req.header('x-myimopay-signature'); // present only with a proxy

const event = constructEvent(rawBody, signature, { allowUnsigned: true });
// event.verified === false — a hint, not proof.

const payment = await client.payments.verify(event.reference);
if (!isPaid(payment)) {
  res.status(200).json({ received: true, ignored: payment.status });
  return;
}

// The verified status is what the bus will accept.
const delivered = await client.payments.events.emit(
  { ...event, status: payment.status },
  { allowUnverified: true },
);
res.status(200).json({ received: true, delivered });
```

`emit` rejects an event marked `verified: false` unless you pass
`{ allowUnverified: true }` — so a forged POST can never reach `onSuccess` just
because it arrived. Always answer `200` for an authentic delivery: subscriber
exceptions are swallowed by the bus, so there is nothing for the provider to
retry.

Framework notes:

- **Express** — `app.post('/webhooks/myimopay', express.raw({ type: 'application/json' }), handler)`,
  then `const rawBody = req.body.toString('utf8')`. A global `express.json()` in
  front of this route makes any signature unmatchable.
- **Fastify** — register a buffer content-type parser:
  `app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))`.
- **Next.js route handler** — `const rawBody = await req.text()`. Never
  `await req.json()` first.
- **Streams** — `readRawBody(req)` drains an async iterable and enforces the
  1 MiB ceiling.

`constructEvent` returns `{ reference, providerReference, status, rawStatus,
isSettled, amountPaid, currency, eventId, verified, raw }`. Both delivery shapes
are accepted (`{ header, data }` and a bare payload). `headerName` defaults to
`x-myimopay-signature` and is descriptive only — you pass the digest value.

Deduplicate on `eventId` when present: one payment produces several deliveries.

## Errors

Every failure is a `MyImoPayError` with a `code`. Use the guard, not
`instanceof`, because a dependency tree can contain two copies of the package:

```ts
import { isMyImoPayError, MyImoPayApiError } from 'myimopay';

try {
  await client.payments.initiate(input);
} catch (error) {
  if (!isMyImoPayError(error)) throw error;

  switch (error.code) {
    case 'VALIDATION_ERROR':
      return badRequest(error.message); // nothing was sent
    case 'DUPLICATE_REFERENCE':
    case 'ALREADY_COMPLETED':
      return resumeExistingPayment(input.reference); // the payment already exists
    case 'RATE_LIMITED':
    case 'TIMEOUT_ERROR':
    case 'NETWORK_ERROR':
      return askClientToRetry();
    case 'INVALID_API_KEY':
    case 'MISSING_API_KEY':
      return reportConfigurationError(error);
    default:
      throw error;
  }
}
```

`MyImoPayValidationError` adds `field`. `MyImoPayApiError` adds `status`,
`remark`, `requestId` and a redacted `body`. `toJSON()` is always safe to log.
The complete table, with the fix for each code, is in
[../../docs/errors.md](../../docs/errors.md).

## Retries and timeouts

One attempt is: build the request, `fetch` with `redirect: 'error'`, read the
body under the 1 MiB ceiling, parse JSON, unwrap the envelope.

- **Retried:** idempotent reads (`GET`) and writes marked `retryableWrite`
  (payment initiation, which the provider de-duplicates on `tx_ref`).
- **Not retried:** subaccount creation and settlement-order create/update. A
  timed-out POST may already have succeeded — retry manually with the same
  `identifier`.
- **Retryable outcomes:** `408`, `425`, `429`, `500`, `502`, `503`, `504`,
  timeouts, and network errors. A `400`/`401`/`404`/`409`/`422` is final.
- **Backoff:** `baseDelayMs * 2^(attempt - 1)` plus up to 100 ms of jitter,
  capped at `maxDelayMs`. A provider `retry-after` is honoured, capped at
  `maxDelayMs` and at 5 minutes.
- **Timeout:** `timeoutMs` applies per attempt, not per call, so a 3-attempt call
  can occupy up to `3 * timeoutMs` plus backoff. Cap it when a request is on a
  user's critical path.
- **Abort:** your `signal` cancels the attempt and any pending backoff and throws
  `ABORTED`; it is never retried.

`onDebug` receives `request`, `response`, `retry` and `error` events with
`method`, `path`, `attempt`, `status`, `durationMs` and a redacted `message`.

## `MyImoPay.fromEnv`

`configFromEnv(env)` — and therefore `MyImoPay.fromEnv(env)` — reads only these
variables. Pass `process.env` (or a plain object in tests); with no argument it
reads nothing and fails on the first missing variable.

| Variable               | Required | Maps to       | Notes                                                   |
| ---------------------- | -------- | ------------- | ------------------------------------------------------- |
| `MYIMOPAY_ENVIRONMENT` | yes      | `environment` | `staging` or `live`, no default                         |
| `MYIMOPAY_PUBLIC_KEY`  | yes      | `publicKey`   | Sent as `xp-key`                                        |
| `MYIMOPAY_SECRET_KEY`  | no       | `secretKey`   | Required only for subaccounts and split orders          |
| `MYIMOPAY_BASE_URL`    | no       | `baseUrl`     | Must be https                                           |
| `MYIMOPAY_TIMEOUT_MS`  | no       | `timeoutMs`   | Whole milliseconds; still validated by the config rules |
| `MYIMOPAY_MAX_AMOUNT`  | no       | `maxAmount`   | Major units; the staging guardrail                      |

Blank or whitespace-only values count as unset. `MYIMOPAY_DEBUG` is read by
nobody: diagnostics go through `onDebug` only, so this SDK cannot start printing
merchant data into a log pipeline by itself.

## Provider quirks that bite

These are behaviours of the provider, not bugs in the SDK. Fighting them loses
money.

1. **`tx_ref` is capped at 20 characters**, `[A-Za-z0-9._-]` only, and must
   contain at least one letter or digit. `client.reference(seed)` sanitises a
   seed and appends `-xxxx`, so it always fits. A 21-character reference is
   rejected locally with `VALIDATION_ERROR`, before the payer is sent anywhere.
2. **Duplicates are idempotency.** A repeat initiation with the same `tx_ref`
   returns the existing payment instead of creating a new one. That is why a
   retried write is safe — and why reusing a reference for a _different_ payment
   silently returns the first payment's data. One reference per payment.
3. **`is_settled: true` wins.** Whatever the integer `status` says, a settled
   transaction is `succeeded`. `mapPaymentStatus` applies it first, in
   verification and in webhooks alike.
4. **Verification is flaky.** `verify` intermittently reports a still-pending
   payment for a transaction that has settled. Treat any non-terminal status as
   "retry later", never as "not paid", and never grant value from a webhook body
   alone.
5. **Splits must total strictly less than 100%.** The merchant keeps the
   remainder. The provider rejects a 100% order _after_ the payment is funded, so
   the SDK rejects it locally instead. `send-merchant-remainder` is the
   documented remedy.
6. **Provider errors can arrive as HTTP 200.** Success is decided by
   `header.is_success`, not by the status code: a `200` with
   `{"header":{"is_success":false},"data":null}` becomes `MyImoPayApiError`
   (`PROVIDER_ERROR`, or `DUPLICATE_REFERENCE`/`ALREADY_COMPLETED` when the
   remark says so).
7. **Empty is not an error.** Settlement and transaction lookups signal "nothing
   matched" with a `404` or a `200` carrying `"data": null`. Settlement reads
   resolve to `[]`/`null`; transaction lookups by reference/id resolve to `null`
   on `404`.
8. **Amounts are major units, sometimes as numeric strings.** The SDK sends the
   initiation amount as a fixed-point string (`"1500.00"`) so no float rounding
   reaches the wire, and normalises every returned amount to a `number`.
9. **Customer names and emails are stricter than the schema.** Punctuation, lone
   one-letter words and single-word names are rejected; an initiation without
   `customer_email` is rejected although the field is documented as optional. The
   `customer` policy normalises the name and requires the email locally, so the
   failure happens before the payer is redirected.
10. **There are no government endpoints.** Nothing in this SDK models a government
    agency, levy or revenue collection, and no such route should be added.

## Related

- [../../docs/api.md](../../docs/api.md) — per-route reference.
- [../../docs/errors.md](../../docs/errors.md) — every error code.
- [../../docs/security.md](../../docs/security.md) — key handling and webhooks.
- [../../docs/lifecycle.md](../../docs/lifecycle.md) — event-bus and checkout firing order.
- [../../docs/testing.md](../../docs/testing.md) — faking `fetch` in tests.
