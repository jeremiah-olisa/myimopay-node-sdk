<!-- @sdk-owner: A13-docs -->

# API reference

Per-resource reference for `myimopay`. Every call method takes `RequestOptions`
as its **last** argument — `{ signal?, timeoutMs?, headers?, baseUrl? }` — and
resolves to a model that always carries `raw: unknown` (the untouched provider
payload). `payments.events` is not a call method: it is the event bus described
under [Payment events](#payment-events).

Auth mode is one of:

- **public** — sends `xp-key` only.
- **secret** — sends `xp-key` and `sp-key`. Requires `secretKey` in the config;
  missing it throws `INVALID_CONFIG` before any network call.

Amounts are major units (`1500` is ₦1,500), never minor units and never strings.
Currencies default to `NGN`. `Date` values are ISO-8601 on the wire.

## References

`tx_ref` is capped at **20 characters**, may only use `[A-Za-z0-9._-]`, must
contain at least one letter or digit, and is validated locally before any network
call. It is also the provider's **idempotency key**: reuse the same reference
when retrying the same payment, never for a different payment.
`client.reference(seed?)` always fits — it sanitises the seed and appends
`-xxxx`, or generates a bare random reference when called with no seed.

## Customer policy

`new MyImoPay({ ..., customer: { ... } })` controls how `customer` fields are
prepared. Every option has a default that matches what the provider accepts in
practice ([provider-notes.md](provider-notes.md)):

| Option                | Default     | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sanitizeName`        | `true`      | `customer.fullName` is run through `sanitizeCustomerName`: accents folded to ASCII, punctuation removed (`"O'Brien-Okafor  Chinedu!"` → `"OBrien Okafor Chinedu"`), a lone one-letter word merged (`"H careplus"` → `"Hcareplus"`), a single word padded (`"Techcourt"` → `"Techcourt Customer"`), and an unusable name replaced with `"Valued Customer"`. `false` sends the name verbatim after whitespace collapsing — only do this if your own code already produces acceptable values |
| `requireEmail`        | `true`      | A missing `customer.email` fails locally with `VALIDATION_ERROR` before the payer is redirected, because the provider rejects such initiations in practice even though its schema marks the field optional. `false` omits `customer_email` from the wire body                                                                                                                                                                                                                             |
| `emailFallbackDomain` | `undefined` | When set, a missing email is derived as `<phone>@domain` (`"08031234567@payments.example.com"`) for flows without an email, such as USSD or POS. Off by default: fabricating an address is a product decision, not an SDK default                                                                                                                                                                                                                                                         |

Email values are trimmed; `undefined`, `null`, `""` and whitespace all mean "no
email"; a malformed address throws `VALIDATION_ERROR` before any network call.

With the defaults, a missing email produces exactly this message:

```text
customer.email is required: MyIMO Pay rejects initiations without one in practice. Pass customer.email, set customer.emailFallbackDomain to derive one from the phone, or set customer.requireEmail to false if you have verified your flow needs none.
```

## Errors every method can throw

Listed once here; each method below notes only what is specific to it. The full
table with fixes is in [errors.md](errors.md).

| Code                                          | Cause                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`                            | Caller input rejected locally — nothing was sent                                    |
| `INVALID_CONFIG`                              | `auth: 'secret'` without a `secretKey`, or a bad config                             |
| `INVALID_API_KEY` / `MISSING_API_KEY`         | `401`/`403` / `412` from the provider                                               |
| `NOT_FOUND`                                   | `404`, on routes that do not treat it as "empty"                                    |
| `CONFLICT`                                    | `409`, typically a duplicate record                                                 |
| `MERCHANT_NOT_READY`                          | `422` — account not activated                                                       |
| `DUPLICATE_REFERENCE` / `ALREADY_COMPLETED`   | A repeat write the provider reports as a failure                                    |
| `RATE_LIMITED` / `PROVIDER_ERROR`             | `429` / any other provider failure, including `200` with `header.is_success: false` |
| `MALFORMED_RESPONSE`                          | A `2xx` body the SDK cannot use                                                     |
| `NETWORK_ERROR` / `TIMEOUT_ERROR` / `ABORTED` | Transport-level failure, timeout, or your own `AbortSignal`                         |

## `client.payments`

### `initiate(input, options?) → Promise<PaymentInitiation>`

`amount` is major units (`1500` = ₦1,500.00), never kobo.

`POST /vi/pay/initiate` · **public** · retried on failure (safe: `tx_ref` is the
provider's de-duplication key).

| Field               | Type     | Required | Notes                                                                             |
| ------------------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `amount`            | `number` | yes      | Major units, `> 0`, ≤ 1e9, at most 2 decimals. Sent as `"1500.00"`                |
| `customer.fullName` | `string` | yes      | Sanitised by default (`sanitizeName`); never sent empty                           |
| `customer.mobile`   | `string` | yes      | Nigerian mobile; normalised to `+234…`                                            |
| `customer.email`    | `string` | yes\*    | \*Required by default (`requireEmail`). Trimmed; must be well-formed              |
| `reference`         | `string` | no       | 1–20 chars of `[A-Za-z0-9._-]`, at least one letter/digit. Generated when omitted |
| `currency`          | `string` | no       | Defaults to `NGN`                                                                 |
| `callbackUrl`       | `string` | no       | Absolute https URL, no embedded credentials                                       |

Returns the `tx_ref` that was sent, the provider reference (falling back to the
reference), `authorizationUrl`, `expiresAt` (provider value, or 24 hours ahead
when unusable), `amount`, `currency`, `raw`.

```ts
const payment = await client.payments.initiate({
  amount: 1500,
  reference: order.id, // <= 20 chars
  customer: { fullName: 'Ada Obi', mobile: '08031234567', email: 'ada@example.com' },
  callbackUrl: 'https://shop.example/checkout/return',
});
// payment.authorizationUrl -> send the payer here
```

Throws `VALIDATION_ERROR` (bad amount/reference/phone/URL/email, a missing
`customer.email` while `requireEmail` is on, or `amount` above `maxAmount`),
`MALFORMED_RESPONSE` (the provider accepted it but returned no `payment_link`),
`DUPLICATE_REFERENCE`, `ALREADY_COMPLETED`, plus the codes listed above.

### `initiateSplit(input, options?) → Promise<PaymentInitiation>`

`POST /vi/pay/initiate/split` · **public key plus `sp-key`** · retried (de-duplicated).

Same fields as `initiate`, plus `settlementOrderId: string` (required,
non-empty). The settlement order decides how the amount is distributed; each
subaccount's share is validated against `assertSettlementPercentages` when the
order is created, and must total strictly less than 100%.

```ts
const split = await client.payments.initiateSplit({
  amount: 10000,
  settlementOrderId: order.id,
  customer: { fullName: 'Ada Obi', mobile: '08031234567', email: 'ada@example.com' },
});
```

Throws the same codes as `initiate`, plus `INVALID_CONFIG` when `secretKey` is
not configured.

### `verify(reference, options?) → Promise<VerifiedPayment>`

`GET /vi/pay/verify/{reference}` · **public** · retried on failure.

This is the only proof of payment the SDK accepts. Returns `status` (`initiated`
| `pending` | `succeeded` | `failed` | `expired` | `unknown`), `rawStatus`,
`isSettled`, `currency`, `amountInitial`, `amountPaid`, `amountCharged`,
`amountPayout`, `chargeBearer`, `isSplit`, `settlementOrderId`, `expiresAt`,
`raw`.

`is_settled: true` always wins over the integer status: a settled transaction is
`succeeded` even if `status` says failed.

```ts
const verified = await client.payments.verify(order.reference);
if (verified.status === 'succeeded') {
  // grant value
}
// A non-terminal status means "ask again later", never "not paid".
```

### `verifyById(id, options?) → Promise<VerifiedPayment>`

`GET /vi/pay/verify/id/{id}` · **public** · retried. Same model as `verify`, for
callers that stored the provider's internal id instead of `tx_ref`.

## Payment events

`payments.events` is the server-side lifecycle API. There is no polling: the bus
subscribes in memory and does nothing until your webhook route calls `emit`,
which is what keeps a library from adding duplicate provider load and a
self-inflicted denial of service.

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
// or, as the provider actually delivers: { allowUnsigned: true } — then verify
await client.payments.events.emit(event);
```

### `events.on(reference, handlers, options?) → () => void`

Subscribes to one reference and returns an idempotent unsubscribe. At least one
of `onSuccess`, `onFailed`, `onExpired`, `onClose` is required. `options.ttlMs`
overrides the default 30-minute lifetime for this subscription.

A subscription costs one in-memory entry: **no timers, no polling, no background
work**. `onSuccess`/`onFailed`/`onExpired` take a `PaymentEvent`
(`{ reference, providerReference, status, raw }`).

### `events.emit(event, options?) → Promise<number>`

Delivers an event to every subscriber for its reference and returns the
delivery count.

- An event marked `verified: false` is **rejected** unless you pass
  `{ allowUnverified: true }`, which asserts that you verified the payment
  server-side first. A forged webhook therefore cannot reach `onSuccess`.
- Only terminal statuses deliver (`succeeded`, `failed`, `expired`).
  `initiated`, `pending` and `unknown` emit nothing and return `0`, without
  consuming the subscription.
- Delivery is once per reference: the subscription is dropped as it is
  delivered, so a re-delivered webhook returns `0` and cannot grant value twice.
- `onClose` fires exactly once, always last: on the terminal delivery, on
  `unsubscribe()`, on TTL expiry (`timeout`), or on `clear()`/eviction.
- Handler exceptions are swallowed, so subscriber code can never fail a webhook
  response.

### `events.size` / `events.clear()`

`size` is the number of live subscriptions after expired ones are discarded.
`clear()` closes every subscription with `cancelled`.

### Defaults and limits

| Option             | Default   | Meaning                                                |
| ------------------ | --------- | ------------------------------------------------------ |
| `ttlMs`            | `1800000` | 30 minutes per subscription, then `onClose('timeout')` |
| `maxSubscriptions` | `10000`   | Hard cap; the oldest subscription is evicted first     |

`createPaymentEventBus({ ttlMs, maxSubscriptions })` is exported for callers
that want those defaults global; `payments.events` is the normal entry point.

### The bus is per-process

The subscriptions live in the process that created them. With more than one
instance — a cluster, several containers, serverless — the webhook can land on a
process that never saw the subscription, and `emit` there returns `0`. There is
no cross-process delivery. Either route the delivery to the subscribing instance
(sticky sessions, or a queue keyed by reference), or persist the outcome and
reconcile from your own store.

If you must poll anyway, do it in your own worker on your own schedule and call
`payments.verify`; reconciliation belongs in your job scheduler, not in this
library.

## `client.transactions`

Read-only history. All routes are **public** and retried on failure.

| Method                           | Route                                  | Returns                        |
| -------------------------------- | -------------------------------------- | ------------------------------ |
| `list(options?)`                 | `GET /vi/transactions`                 | `Promise<Transaction[]>`       |
| `filter(query?, options?)`       | `GET /vi/transactions/filter`          | `Promise<TransactionPage>`     |
| `findByReference(reference, o?)` | `GET /vi/transactions/reference/{ref}` | `Promise<Transaction \| null>` |
| `findById(identifier, options?)` | `GET /vi/transactions/identity/{id}`   | `Promise<Transaction \| null>` |
| `summary(range?, options?)`      | `GET /vi/transactions/summary`         | `Promise<ProviderRecord>`      |
| `statusCounts(options?)`         | `GET /vi/transactions/status-counts`   | `Promise<ProviderRecord>`      |
| `analytics(days?, options?)`     | `GET /vi/transactions/analytics`       | `Promise<ProviderRecord>`      |

`TransactionQuery`: `page`, `pageSize`, `status` (`PaymentStatus | number`),
`fromDate`/`toDate` (`string | Date`), `search`, `sortBy`, `sortOrder`
(`'asc' | 'desc'`). Status names map to the provider integers (`initiated` 0,
`pending` 1, `succeeded` 2, `failed` 3, `expired` 4); `unknown` is passed through
because it has no integer.

`summary(range?)` sends the date window only when **both** bounds are supplied.
`analytics(days?)` sends `days` only when it is a positive integer.

```ts
const page = await client.transactions.filter({
  status: 'succeeded',
  fromDate: new Date('2026-10-01T00:00:00Z'),
  toDate: new Date('2026-10-31T23:59:59Z'),
  page: 1,
  pageSize: 50,
});
for (const transaction of page.items) {
  transaction.amountPaid;
}
```

`findByReference`/`findById` resolve to `null` on `404`. `summary`,
`statusCounts` and `analytics` are deliberately **not** re-modelled: the provider
shape is unstable, so they return `Record<string, unknown>`.

## `client.settlements`

Settlement reports. **public**, retried. "Nothing matched" is an empty result,
not an error: lists resolve to `[]`, single lookups to `null`.

| Method                             | Route                                                  | Returns                             |
| ---------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| `directs(query?, options?)`        | `GET /vi/settlements/directs` (or `/filter/daterange`) | `Promise<DirectSettlement[]>`       |
| `splits(query?, options?)`         | `GET /vi/settlements/splits` (or `/filter/daterange`)  | `Promise<SplitSettlement[]>`        |
| `directByReference(reference, o?)` | `GET /vi/settlements/directs/transaction/ref/{ref}`    | `Promise<DirectSettlement \| null>` |
| `splitByReference(reference, o?)`  | `GET /vi/settlements/splits/transaction/ref/{ref}`     | `Promise<SplitSettlement \| null>`  |
| `splitByOrder(orderId, options?)`  | `GET /vi/settlements/splits/order/{id}`                | `Promise<SplitSettlement[]>`        |

`SettlementQuery` is `{ fromDate?, toDate? }`. The window is **all or nothing**:
supplying one bound and not the other throws `VALIDATION_ERROR`, because the
filter route silently ignores a half window and would return the whole report.
When both are present the request goes to `…/filter/daterange?from=<iso>&to=<iso>`.

```ts
const rows = await client.settlements.splits({
  fromDate: '2026-10-01T00:00:00.000Z',
  toDate: '2026-10-31T23:59:59.000Z',
});
const allocations = rows[0]?.allocations ?? [];
```

`SplitSettlement` adds `allocations: SplitAllocation[]` to the `DirectSettlement`
shape (`subaccountId`, `percentAmount`, `fixedAmount`, `isFixed`, `raw`). A
split row has no `chargeBearer`; `settlementOrderId` stays nullable because the
provider omits it on some rows.

## `client.banks`

Bank directory and account-name resolution. **public**, retried.

### `list(countryCode, options?) → Promise<Bank[]>`

`GET /vi/entities/banks/{COUNTRY}`. `countryCode` is ISO-3166 alpha-2 and is
upper-cased (`NG`, `ng` both work). Rows map to `code`, `name`, `countryCode`,
`swiftCode`, `bankType`, `routingNumber`, `raw`; every field except `raw` is
`string | null`. An empty payload array maps to `[]`, and rows that are not
objects are dropped.

### `resolve({ bankCode, accountNumber }, options?) → Promise<BankAccount>`

`GET /vi/entities/banks/account/{bankCode}/{accountNumber}/resolve`. Both values
must be letters/digits only — anything that could reshape the URL path is
rejected with `VALIDATION_ERROR`. Returns `bankCode`, `accountNumber`,
`accountName`, `branchCode`, `raw`.

```ts
const account = await client.banks.resolve({ bankCode: '058', accountNumber: '0123456789' });
if (account.accountName?.toLowerCase() !== input.accountName.toLowerCase()) {
  throw new Error('account name does not match');
}
```

Use this before creating a subaccount: it is the only way to catch a mistyped
account number before money is routed to it.

## `client.subaccounts`

Merchant subaccounts. **secret**, retried on GET only. Requires `secretKey`.

| Method                    | Route                                                 | Returns                 |
| ------------------------- | ----------------------------------------------------- | ----------------------- |
| `list(options?)`          | `GET /vi/entities/merchant/subaccounts/accounts`      | `Promise<Subaccount[]>` |
| `get(id, options?)`       | `GET /vi/entities/merchant/subaccounts/accounts/{id}` | `Promise<Subaccount>`   |
| `create(input, options?)` | `POST /vi/entities/merchant/subaccounts/accounts/add` | `Promise<Subaccount>`   |

`CreateSubaccountInput`: `name`, `bankCode`, `bankName`, `accountNumber`
(exactly 10 digits), `accountName`, optional `currency` (default `NGN`),
`email`, `phone` (normalised to `+234…`), and `identifier`.

`identifier` is the provider's de-duplication key. Pass your own stable value if
you may retry; when omitted the SDK generates a fresh reference for that one
call, so a retry of that call creates a second record.

```ts
const subaccount = await client.subaccounts.create({
  name: 'Ada Stores',
  bankCode: '058',
  bankName: 'Guaranty Trust Bank',
  accountNumber: '0123456789',
  accountName: 'ADA OBI',
  identifier: 'vendor-1042',
});
```

A duplicate bank code + account number surfaces as `CONFLICT` (HTTP 409).
`create` is **not** auto-retried: a timed-out POST may already have created the
record, so retry with the same `identifier` instead of letting the transport do
it.

## `client.settlementOrders`

Split instructions. **secret**. Requires `secretKey`.

| Method                    | Route                                               | Returns                      |
| ------------------------- | --------------------------------------------------- | ---------------------------- |
| `list(options?)`          | `GET /vi/entities/merchant/settlements/orders`      | `Promise<SettlementOrder[]>` |
| `get(id, options?)`       | `GET /vi/entities/merchant/settlements/orders/{id}` | `Promise<SettlementOrder>`   |
| `create(input, options?)` | `POST /vi/entities/merchant/settlements/orders/add` | `Promise<SettlementOrder>`   |
| `update(id, input, o?)`   | `PUT /vi/entities/merchant/settlements/orders/edit` | `Promise<SettlementOrder>`   |

`CreateSettlementOrderInput`: `name`, `items: SettlementOrderItemInput[]`,
optional `chargeBearer` (`merchant` | `customer` | `split`, default `customer`),
`overrideChargeBearer`, `identifier`.

Each item is `{ subaccountId, percentage?, fixedAmount?, isFixed? }`.

Local rules, all enforced before the request leaves the process:

- at least one item;
- no subaccount may appear twice (the provider silently collapses duplicates);
- `percentage` must be `> 0` and `< 100`, and all percentages together must
  total **strictly less than 100%** — the merchant keeps the remainder;
- `fixedAmount` must satisfy `assertAmount`.

`update(id, input)` sends the id as the provider's `identifier`, and repeats it
as `settlement_order_id` when the id looks like a UUID. `create` and `update`
are **not** auto-retried.

```ts
const order = await client.settlementOrders.create({
  name: 'October split',
  items: [
    { subaccountId: 'sub_1', percentage: 40 },
    { subaccountId: 'sub_2', percentage: 25 },
  ],
});
```

## Webhooks

`constructEvent(rawBody, signature, options) → WebhookEvent`

| Field               | Type             | Source                                                    |
| ------------------- | ---------------- | --------------------------------------------------------- |
| `reference`         | `string`         | `tx_reference`, `tx_ref` or `reference` — required        |
| `providerReference` | `string \| null` | `provider_reference`                                      |
| `status`            | `PaymentStatus`  | `mapPaymentStatus(status, is_settled)`                    |
| `rawStatus`         | `number \| null` | `status`                                                  |
| `isSettled`         | `boolean`        | `is_settled` (`true`, `1` and `"1"` all count)            |
| `amountPaid`        | `number`         | `paid_amount`, falling back to `charged_amount`, then `0` |
| `currency`          | `string`         | upper-cased `currency`, default `NGN`                     |
| `eventId`           | `string \| null` | `id` or `identifier`                                      |
| `verified`          | `boolean`        | `true` only when the HMAC was checked against your secret |
| `raw`               | `unknown`        | the whole parsed delivery, envelope included              |

Both delivery shapes are accepted: a bare payload, and a `{ header, data }`
envelope (the `data` object is projected).

```ts
import { MyImoPay } from 'myimopay';

const event = MyImoPay.webhooks.constructEvent(rawBody, signature, {
  secret: process.env.MYIMOPAY_WEBHOOK_SECRET ?? '',
});

// Hand the verified delivery to the subscriber waiting in the process that
// created the payment. Terminal statuses only; a duplicate returns 0.
const delivered = await client.payments.events.emit(event);

// A webhook is a trigger, never proof of amount. The subscriber re-reads it:
const payment = await client.payments.verify(event.reference);
```

`emit` returns `0` for a duplicate delivery, a non-terminal status, a reference
this process is not subscribed to, or a webhook that landed on a different
instance. Always answer `200` for an authentic delivery: subscriber exceptions
are swallowed by the bus and there is nothing for the provider to retry.

Helpers on the same namespace (and exported top-level):

| Export                   | Signature                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `verifyWebhookSignature` | `(rawBody: string \| Uint8Array, signature: string \| null \| undefined, secret: string) => boolean`               |
| `constructEvent`         | `(rawBody: string \| Uint8Array, signature: string \| null \| undefined, options: WebhookOptions) => WebhookEvent` |
| `signWebhookPayload`     | `(rawBody: string, secret: string) => string` — lower-case hex SHA-256 HMAC                                        |
| `readRawBody`            | `(source: AsyncIterable<Uint8Array>) => Promise<string>` — 1 MiB ceiling                                           |
| `assertRawBodyString`    | `(body: unknown) => string` — throws when the framework already parsed it                                          |

`headerName` is descriptive only: it is validated but never read, because you
pass the digest value yourself. The default is `x-myimopay-signature`.

## Utilities worth knowing

Exported from both packages where it makes sense (see the root
[CONTRACTS.md](CONTRACTS.md) for the full list):

| Export                     | Use                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `client.reference(seed?)`  | Reference that always fits 20 characters (`seed` sanitised + `-xxxx`)                                                        |
| `sanitizeReference(value)` | Coerces your own id (invoice with slashes, UUID, timestamp) into a valid `tx_ref`; deterministic, never adds a random suffix |
| `assertReference`          | Validate a caller-supplied reference before you store it                                                                     |
| `sanitizeCustomerName`     | Provider-safe full name (punctuation, initials, single words)                                                                |
| `normalizeCustomerEmail`   | Trim and validate an optional email; blank means missing                                                                     |
| `deriveEmailFromPhone`     | `<national-phone>@domain` for flows with no email                                                                            |
| `formatMoney`              | `₦1,500.10` display formatting (server-side)                                                                                 |
| `formatAmount`             | The browser-side equivalent                                                                                                  |
| `mapPaymentStatus`         | Non-throwing numeric → `PaymentStatus`                                                                                       |
| `isPaid`                   | `payment.status === 'succeeded'`                                                                                             |
| `isTerminalStatus`         | `succeeded \| failed \| expired`                                                                                             |
| `redact` / `redactHeaders` | Everything that leaves the process before it reaches a log                                                                   |
