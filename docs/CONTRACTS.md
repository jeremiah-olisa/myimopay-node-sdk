<!-- @sdk-owner: A13-docs -->

# Frozen public contracts

Every symbol below is public API for v1. Ten parallel workstreams implement
against these signatures; changing one is a breaking change even while the
packages are at `0.x`, because consumers are already written against them.

- `@myimopay/core` is **private** and bundled into both published packages. It
  is the shared vocabulary, never an install target.
- `myimopay` re-exports the entire core surface.
- `myimopay-browser` re-exports the core **errors** and the core **types** only.
  It has no key parameter anywhere, and no Node built-in anywhere.

Signature conventions used below: `?` marks an optional property, `|` unions,
`Promise<T>` is an async method. `Amount` is major units (`number`), never minor
units and never a string. Every model carries `raw: unknown`, the untouched
provider payload.

## Overriding anything, at any time

Nothing is locked at construction time. From coarsest to finest:

1. `environment: 'staging' | 'live'` selects the default host.
2. `environments: { staging?, live? }` remaps a host without changing the environment.
3. `baseUrl` overrides that host for the whole client (and makes `environment` optional).
4. `client.with({ ...overrides })` derives a new client (any option, including
   keys, timeout, retry, headers, guardrails). The original is untouched.
5. Every resource method takes `RequestOptions` last, so a single call can
   override `baseUrl`, `timeoutMs`, `headers` and `signal`.

Credentials are the one exception: they are never passed per call.

## Import aliases

Source and tests use these aliases (wired in the root `tsconfig.json` and
resolved by tsup at build time, so nothing leaks into `dist`):

| Alias            | Resolves to                  |
| ---------------- | ---------------------------- |
| `@core/*`        | `packages/core/src/*`        |
| `@node/*`        | `packages/node/src/*`        |
| `@browser/*`     | `packages/browser/src/*`     |
| `@myimopay/core` | `packages/core/src/index.ts` |

Published code imports the core package by name (`@myimopay/core`); tests may
reach for the finer-grained aliases instead of `../../..` chains.

## Shared vocabulary (`@myimopay/core`, re-exported by both packages)

### Errors

Each class extends `MyImoPayError` and carries `code: MyImoPayErrorCode`;
`toJSON()` is safe to log and never contains credentials.

| Symbol                    | Signature                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MyImoPayErrorCode`       | `'VALIDATION_ERROR' \| 'INVALID_CONFIG' \| 'INVALID_API_KEY' \| 'MISSING_API_KEY' \| 'FORBIDDEN' \| 'NOT_FOUND' \| 'CONFLICT' \| 'DUPLICATE_REFERENCE' \| 'ALREADY_COMPLETED' \| 'MERCHANT_NOT_READY' \| 'RATE_LIMITED' \| 'PROVIDER_ERROR' \| 'MALFORMED_RESPONSE' \| 'NETWORK_ERROR' \| 'TIMEOUT_ERROR' \| 'ABORTED' \| 'WEBHOOK_SIGNATURE_INVALID' \| 'SERVER_ONLY' \| 'UNKNOWN'` |
| `MyImoPayError`           | `new (options: MyImoPayErrorOptions)` · `readonly code`                                                                                                                                                                                                                                                                                                                              |
| `MyImoPayValidationError` | `new (message: string, field?: string)` · `readonly field: string \| null`                                                                                                                                                                                                                                                                                                           |
| `MyImoPayApiError`        | `new (options: MyImoPayApiErrorOptions)` · `readonly status, remark, requestId, body`                                                                                                                                                                                                                                                                                                |
| `MyImoPayNetworkError`    | `new (message: string, cause?: unknown, code?: MyImoPayErrorCode)`                                                                                                                                                                                                                                                                                                                   |
| `MyImoPayTimeoutError`    | `new (message?: string, cause?: unknown)`                                                                                                                                                                                                                                                                                                                                            |
| `MyImoPayWebhookError`    | `new (message: string)`                                                                                                                                                                                                                                                                                                                                                              |
| `isMyImoPayError`         | `(value: unknown) => value is MyImoPayError`                                                                                                                                                                                                                                                                                                                                         |

### Transport

| Symbol               | Signature                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HttpClient`         | `new (config: HttpConfig)` · `get httpConfig(): HttpConfig` · `request<T>(options: HttpRequestOptions): Promise<ApiResult<T>>`                                  |
| `HttpConfig`         | `{ baseUrl, publicKey, secretKey?, publicKeyHeader, secretKeyHeader, timeoutMs, retry: Required<RetryConfig>, headers, fetch: FetchLike, onDebug?, userAgent }` |
| `HttpRequestOptions` | `{ method: HttpMethod; path: string; query?; body?; auth?: 'public' \| 'secret' \| 'none'; baseUrl?; timeoutMs?; retryableWrite?: boolean; signal?; headers? }` |
| `RequestOptions`     | `{ signal?: AbortSignal; timeoutMs?: number; headers?: Record<string, string>; baseUrl?: string }` — accepted as the last argument of every resource method     |
| `HttpMethod`         | `'GET' \| 'POST' \| 'PUT' \| 'DELETE'`                                                                                                                          |
| `FetchLike`          | `(input: string, init?: RequestInitLike) => Promise<FetchResponseLike>`                                                                                         |
| `FetchResponseLike`  | `{ readonly ok; readonly status; readonly headers: { get(name): string \| null }; text(): Promise<string> }`                                                    |
| `RetryConfig`        | `{ attempts?: number; baseDelayMs?: number; maxDelayMs?: number }`                                                                                              |
| `ApiResult<T>`       | `{ data: T; header: ResponseHeader; status: number; raw: unknown }`                                                                                             |
| `ResponseHeader`     | `{ isSuccess: boolean; status: string \| null; remark: string \| null; timeStamp: number \| null }`                                                             |
| `WireEnvelope<T>`    | `{ header?: WireHeader \| null; data?: T \| null }`                                                                                                             |
| `DebugEvent`         | `{ type: 'request' \| 'response' \| 'retry' \| 'error'; method; path; attempt; status?; durationMs?; message? }`                                                |

### Models

| Symbol                       | Signature                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Environment`                | `'staging' \| 'live'`                                                                                                                                                                                                                                                                                                                            |
| `PaymentStatus`              | `'initiated' \| 'pending' \| 'succeeded' \| 'failed' \| 'expired' \| 'unknown'`                                                                                                                                                                                                                                                                  |
| `ChargeBearer`               | `'merchant' \| 'customer' \| 'split'`                                                                                                                                                                                                                                                                                                            |
| `Customer`                   | `{ fullName: string; mobile: string; email?: string }`                                                                                                                                                                                                                                                                                           |
| `InitiatePaymentInput`       | `{ amount; currency?; reference?; customer: Customer; callbackUrl? }`                                                                                                                                                                                                                                                                            |
| `InitiateSplitPaymentInput`  | `InitiatePaymentInput & { settlementOrderId: string }`                                                                                                                                                                                                                                                                                           |
| `PaymentInitiation`          | `{ reference; providerReference; authorizationUrl; expiresAt: Date; amount; currency; raw }`                                                                                                                                                                                                                                                     |
| `VerifiedPayment`            | `{ reference; providerReference: string \| null; status; rawStatus: number \| null; isSettled: boolean; currency; amountInitial; amountPaid; amountCharged; amountPayout; chargeBearer: ChargeBearer \| null; isSplit: boolean; settlementOrderId: string \| null; expiresAt: Date \| null; raw }`                                               |
| `isPaid`                     | `(payment: Pick<VerifiedPayment, 'status'>) => boolean`                                                                                                                                                                                                                                                                                          |
| `Transaction`                | `{ id; reference; providerReference; payReference; status; rawStatus; isSettled; isSplit; currency; amountInitial; amountCharged; amountPaid; amountPayout; feeAmount; taxAmount; adminFeeAmount; chargeBearer; customerName; customerEmail; customerPhone; settlementOrderId; callbackUrl; paymentLink; expiresAt; createdAt; updatedAt; raw }` |
| `TransactionQuery`           | `{ page?; pageSize?; status?: PaymentStatus \| number; fromDate?: string \| Date; toDate?: string \| Date; search?; sortBy?; sortOrder?: 'asc' \| 'desc' }`                                                                                                                                                                                      |
| `TransactionPage`            | `{ items: Transaction[]; total: number \| null; page: number \| null; pageSize: number \| null; raw }`                                                                                                                                                                                                                                           |
| `DateRangeQuery`             | `{ fromDate?: string \| Date; toDate?: string \| Date }`                                                                                                                                                                                                                                                                                         |
| `ProviderRecord`             | `Record<string, unknown>`                                                                                                                                                                                                                                                                                                                        |
| `DirectSettlement`           | `{ reference; providerReference; status; rawStatus; currency; amount; settledAmount; feeAmount; taxAmount; adminFeeAmount; chargeBearer; settlementOrderId; settledAt: Date \| null; raw }`                                                                                                                                                      |
| `SplitSettlement`            | `DirectSettlement` shape plus `allocations: SplitAllocation[]` and required `settlementOrderId`                                                                                                                                                                                                                                                  |
| `SplitAllocation`            | `{ subaccountId: string \| null; percentAmount; fixedAmount; isFixed: boolean; raw }`                                                                                                                                                                                                                                                            |
| `SettlementQuery`            | `{ fromDate?: string \| Date; toDate?: string \| Date }`                                                                                                                                                                                                                                                                                         |
| `Bank`                       | `{ code; name; countryCode; swiftCode; bankType; routingNumber; raw }` (all `string \| null` except `raw`)                                                                                                                                                                                                                                       |
| `BankAccount`                | `{ bankCode; accountNumber; accountName; branchCode; raw }`                                                                                                                                                                                                                                                                                      |
| `Subaccount`                 | `{ id; code; name; bankCode; bankName; accountNumber; accountName; currency; email; phone; createdAt; updatedAt; raw }`                                                                                                                                                                                                                          |
| `CreateSubaccountInput`      | `{ name; bankCode; bankName; accountNumber; accountName; currency?; email?; phone?; identifier? }`                                                                                                                                                                                                                                               |
| `SettlementOrder`            | `{ id; name; chargeBearer: ChargeBearer \| null; overrideChargeBearer: boolean; isMixed: boolean; items: SettlementOrderItem[]; createdAt; updatedAt; raw }`                                                                                                                                                                                     |
| `SettlementOrderItem`        | `{ subaccountId: string \| null; percentage; fixedAmount; isFixed; raw }`                                                                                                                                                                                                                                                                        |
| `SettlementOrderItemInput`   | `{ subaccountId: string; percentage?; fixedAmount?; isFixed? }`                                                                                                                                                                                                                                                                                  |
| `CreateSettlementOrderInput` | `{ name; items: SettlementOrderItemInput[]; chargeBearer?; overrideChargeBearer?; identifier? }`                                                                                                                                                                                                                                                 |

### Utilities

| Symbol                                   | Signature                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `assertAmount`                           | `(amount: unknown, field?: string) => asserts amount is Amount`                                                             |
| `toApiAmount`                            | `(amount: Amount, field?: string) => string`                                                                                |
| `formatMoney`                            | `(amount: Amount, currency?: string, locale?: string) => string`                                                            |
| `toNumber`                               | `(value: Numeric \| null \| undefined, field: string) => number`                                                            |
| `toNumberOr`                             | `(value: Numeric \| null \| undefined, field: string, fallback: number) => number`                                          |
| `normalizeNigerianPhone`                 | `(phone: string) => string`                                                                                                 |
| `assertPhone`                            | `(phone: unknown, field?: string) => string`                                                                                |
| `sanitizeCustomerName`                   | `(raw: string \| null \| undefined, options?: { fallback?: string; maxLength?: number }) => string`                         |
| `normalizeCustomerEmail`                 | `(email: unknown, field?: string) => string \| undefined`                                                                   |
| `deriveEmailFromPhone`                   | `(phone: string, domain: string) => string`                                                                                 |
| `assertReference`                        | `(reference: unknown, field?: string) => string`                                                                            |
| `createReference`                        | `(seed?: string, random?: () => number) => string`                                                                          |
| `sanitizeReference`                      | `(value: string, random?: () => number) => string` — coerces any caller id into a valid `tx_ref`, deterministically         |
| `MAX_REFERENCE_LENGTH`                   | `20`                                                                                                                        |
| `REFERENCE_PATTERN`                      | `/^[A-Za-z0-9._-]+$/`                                                                                                       |
| `maskValue` / `redact` / `redactHeaders` | `(value: string) => string` · `(value: unknown) => unknown` · `(headers: Record<string, string>) => Record<string, string>` |
| `assertSettlementPercentages`            | `(items: SettlementOrderItemInput[]) => void`                                                                               |
| `mapPaymentStatus`                       | `(status: Numeric \| null \| undefined, isSettled?: boolean \| null) => PaymentStatus`                                      |
| `mapChargeBearer`                        | `(bearer: Numeric \| null \| undefined) => ChargeBearer \| null`                                                            |
| `isTerminalStatus`                       | `(status: PaymentStatus) => boolean`                                                                                        |
| `assertNonEmptyString`                   | `(value: unknown, field: string) => string`                                                                                 |
| `assertHttpsUrl`                         | `(value: unknown, field: string) => string`                                                                                 |
| `normalizeCurrency`                      | `(currency: string \| undefined, field?: string) => string`                                                                 |
| `normalizeCountryCode`                   | `(countryCode: unknown, field?: string) => string`                                                                          |
| `joinUrl`                                | `(baseUrl: string, path: string) => string`                                                                                 |
| `buildQuery`                             | `(query: Record<string, string \| number \| boolean \| undefined>) => string`                                               |

## `myimopay` (server)

Re-exports the entire core surface plus:

| Symbol                      | Signature                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MyImoPay`                  | `new (config: MyImoPayConfig)`                                                                                                                                                                                                       |
| `MyImoPay.payments`         | `PaymentsResource`                                                                                                                                                                                                                   |
| `MyImoPay.transactions`     | `TransactionsResource`                                                                                                                                                                                                               |
| `MyImoPay.settlements`      | `SettlementsResource`                                                                                                                                                                                                                |
| `MyImoPay.banks`            | `BanksResource`                                                                                                                                                                                                                      |
| `MyImoPay.subaccounts`      | `SubaccountsResource`                                                                                                                                                                                                                |
| `MyImoPay.settlementOrders` | `SettlementOrdersResource`                                                                                                                                                                                                           |
| `MyImoPay#reference`        | `(seed?: string) => string`                                                                                                                                                                                                          |
| `MyImoPay#environment`      | `get environment(): 'staging' \| 'live'`                                                                                                                                                                                             |
| `MyImoPay#baseUrl`          | `get baseUrl(): string`                                                                                                                                                                                                              |
| `MyImoPay#with`             | `(overrides: Partial<MyImoPayConfig>) => MyImoPay` — derives a client with any option overridden                                                                                                                                     |
| `DEFAULT_BASE_URLS`         | `Readonly<Record<Environment, string>>` — staging `https://apipg.demo.myimopay.com`, live `https://api.myimopay.com`                                                                                                                 |
| `MyImoPay.fromEnv`          | `(env?: EnvLike) => MyImoPay`                                                                                                                                                                                                        |
| `MyImoPay.webhooks`         | `{ constructEvent; verifyWebhookSignature; signWebhookPayload }`                                                                                                                                                                     |
| `createClient`              | `(config: MyImoPayConfig) => MyImoPay`                                                                                                                                                                                               |
| `MyImoPayConfig`            | `{ environment?; environments?; publicKey; secretKey?; baseUrl?; timeoutMs?; retry?; headers?; publicKeyHeader?; secretKeyHeader?; fetch?; onDebug?; maxAmount?; customer? }` — `environment` is optional only when `baseUrl` is set |
| `ResourceContext`           | `{ readonly http: HttpClient; readonly maxAmount: number \| undefined; readonly customer: ResolvedCustomerPolicy \| undefined }`                                                                                                     |
| `ResolvedCustomerPolicy`    | `{ readonly sanitizeName: boolean; readonly requireEmail: boolean; readonly emailFallbackDomain: string \| undefined }`                                                                                                              |
| `createPaymentEventBus`     | `(options?: PaymentEventBusOptions) => PaymentEventBus`                                                                                                                                                                              |
| `EnvLike`                   | `{ readonly [key: string]: string \| undefined }`                                                                                                                                                                                    |
| `configFromEnv`             | `(env?: EnvLike) => MyImoPayConfig`                                                                                                                                                                                                  |
| `readRawBody`               | `(source: AsyncIterable<Uint8Array>) => Promise<string>`                                                                                                                                                                             |
| `assertRawBodyString`       | `(body: unknown) => string`                                                                                                                                                                                                          |

### Customer policy (`MyImoPayConfig.customer`)

Defaults match what the provider accepts in practice; every switch is opt-out,
so a caller that already normalises its own data is never second-guessed.

| Option                | Type      | Default     | Effect                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | --------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sanitizeName`        | `boolean` | `true`      | Runs `sanitizeCustomerName` on `customer.fullName`: punctuation and accents folded to ASCII, lone one-letter words merged (`"H careplus"` → `"Hcareplus"`), single words padded (`"Techcourt"` → `"Techcourt Customer"`), unusable names → `"Valued Customer"`. `false` sends the name verbatim (whitespace collapsed only), for callers that normalise it themselves |
| `requireEmail`        | `boolean` | `true`      | The provider schema marks `customer_email` optional but rejects initiations without one in practice, so a missing email fails locally with `VALIDATION_ERROR` before the payer is redirected. `false` omits the field                                                                                                                                                 |
| `emailFallbackDomain` | `string`  | `undefined` | When set, a missing email is derived as `<phone>@domain` via `deriveEmailFromPhone` (USSD/POS flows). Fabricating an address is a product decision, so it is opt-in. Must be a bare domain such as `example.com`                                                                                                                                                      |

Email values are trimmed; blank or whitespace-only means missing; a malformed
address throws `VALIDATION_ERROR` before any network call.

### Resources

| Symbol                     | Signature                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PaymentsResource`         | `readonly events: PaymentEventBus` · `initiate(input: InitiatePaymentInput, options?: RequestOptions): Promise<PaymentInitiation>` · `initiateSplit(input: InitiateSplitPaymentInput, options?: RequestOptions): Promise<PaymentInitiation>` · `verify(reference: string, options?: RequestOptions): Promise<VerifiedPayment>` · `verifyById(id: string, options?: RequestOptions): Promise<VerifiedPayment>`                                                                                                                                                                        |
| `TransactionsResource`     | `list(options?: RequestOptions): Promise<Transaction[]>` · `filter(query?: TransactionQuery, options?: RequestOptions): Promise<TransactionPage>` · `findByReference(reference: string, options?: RequestOptions): Promise<Transaction \| null>` · `findById(identifier: string, options?: RequestOptions): Promise<Transaction \| null>` · `summary(range?: DateRangeQuery, options?: RequestOptions): Promise<ProviderRecord>` · `statusCounts(options?: RequestOptions): Promise<ProviderRecord>` · `analytics(days?: number, options?: RequestOptions): Promise<ProviderRecord>` |
| `SettlementsResource`      | `directs(query?: SettlementQuery, options?: RequestOptions): Promise<DirectSettlement[]>` · `splits(query?: SettlementQuery, options?: RequestOptions): Promise<SplitSettlement[]>` · `directByReference(reference: string, options?: RequestOptions): Promise<DirectSettlement \| null>` · `splitByReference(reference: string, options?: RequestOptions): Promise<SplitSettlement \| null>` · `splitByOrder(settlementOrderId: string, options?: RequestOptions): Promise<SplitSettlement[]>`                                                                                      |
| `BanksResource`            | `list(countryCode: string, options?: RequestOptions): Promise<Bank[]>` · `resolve(input: { bankCode: string; accountNumber: string }, options?: RequestOptions): Promise<BankAccount>`                                                                                                                                                                                                                                                                                                                                                                                               |
| `SubaccountsResource`      | `list(options?: RequestOptions): Promise<Subaccount[]>` · `get(id: string, options?: RequestOptions): Promise<Subaccount>` · `create(input: CreateSubaccountInput, options?: RequestOptions): Promise<Subaccount>`                                                                                                                                                                                                                                                                                                                                                                   |
| `SettlementOrdersResource` | `list(options?: RequestOptions): Promise<SettlementOrder[]>` · `get(id: string, options?: RequestOptions): Promise<SettlementOrder>` · `create(input: CreateSettlementOrderInput, options?: RequestOptions): Promise<SettlementOrder>` · `update(id: string, input: CreateSettlementOrderInput, options?: RequestOptions): Promise<SettlementOrder>`                                                                                                                                                                                                                                 |

### Payment events (`payments.events`)

The server SDK has no polling API. `payments.watch` and `watchPayment` were
removed: a library that polls verification on your behalf invites duplicate
provider load and a self-inflicted denial of service, so reconciliation belongs
in the caller's job scheduler. The lifecycle is event-based instead.

| Symbol                   | Signature                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PaymentEvent`           | `{ reference: string; providerReference: string \| null; status: PaymentStatus; raw: unknown }`                                                                           |
| `PaymentEventOutcome`    | `'succeeded' \| 'failed' \| 'expired' \| 'timeout' \| 'cancelled'`                                                                                                        |
| `PaymentEventHandlers`   | `{ onSuccess?; onFailed?; onExpired? }` — each `(event: PaymentEvent) => void \| Promise<void>`; `onClose?(outcome: PaymentEventOutcome)`                                 |
| `PaymentEventOptions`    | `{ ttlMs?: number }` — per-subscription lifetime, default 30 minutes                                                                                                      |
| `PaymentEventBus`        | `on(reference, handlers, options?) => () => void` · `emit(event, options?: { allowUnverified?: boolean }) => Promise<number>` · `readonly size: number` · `clear(): void` |
| `PaymentEventBusOptions` | `{ ttlMs?: number (1800000); maxSubscriptions?: number (10000) }`                                                                                                         |

Call order and guarantees:

1. `on()` subscribes to one reference before the payer is redirected and
   returns an idempotent unsubscribe. A subscription is one in-memory map entry:
   no timer, no polling and no background work, so the bus is idle until `emit`.
2. `emit(event)` is called from the webhook route. An event with `verified: false`
   is rejected unless `{ allowUnverified: true }` is passed. Only
   terminal statuses deliver (`succeeded \| failed \| expired`); `initiated`,
   `pending` and `unknown` emit nothing and return `0` without consuming the
   subscription.
3. Delivery happens once per reference. All live subscribers for that reference
   receive the event (return value = delivery count), then the subscriptions are
   dropped, so a re-delivered webhook returns `0` and cannot grant value twice.
4. `onClose` fires exactly once and always last: the terminal delivery, an
   `unsubscribe()`, TTL expiry (`timeout`), or `clear()`/cap eviction
   (`cancelled` for `clear()`, `timeout` for a TTL sweep or eviction).
5. Defaults: TTL 30 minutes, at most 10 000 live subscriptions. Subscribing past
   the cap evicts the oldest subscription with `timeout`.
6. Handler exceptions — sync or async — are swallowed, so subscriber code can
   never fail a webhook response or a delivery.
7. The bus is **per-process**. With more than one instance the webhook may land
   on a process that holds no subscription and `emit` returns `0` there. Route
   the delivery to the subscribing instance, or persist the outcome and
   reconcile from your own store; cross-process delivery does not exist.
8. The event is a **signal, not proof of amount**. It carries the reference and
   the terminal status; re-read the amount from your own records (or
   `payments.verify`) before granting value.

### Webhooks

| Symbol                   | Signature                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WebhookEvent`           | `{ reference; providerReference; status; rawStatus; isSettled; amountPaid; currency; eventId; verified: boolean; raw }` — `verified` is true only for an HMAC-checked delivery |
| `WebhookOptions`         | `{ secret: string; headerName?: string; allowUnsigned?: never } \| { allowUnsigned: true; headerName?: string; secret?: never }` — omitting both is a type error               |
| `verifyWebhookSignature` | `(rawBody: string \| Uint8Array, signature: string \| null \| undefined, secret: string) => boolean`                                                                           |
| `constructEvent`         | `(rawBody: string \| Uint8Array, signature: string \| null \| undefined, options: WebhookOptions) => WebhookEvent`                                                             |
| `signWebhookPayload`     | `(rawBody: string, secret: string) => string`                                                                                                                                  |

## `myimopay-browser`

No key parameter exists in this package, by design.

| Symbol                  | Signature                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CheckoutMode`          | `'redirect' \| 'popup'`                                                                                                                                                                                                                  |
| `CheckoutOutcome`       | `'redirected' \| 'returned' \| 'closed' \| 'blocked' \| 'timeout' \| 'succeeded' \| 'failed' \| 'expired' \| 'error'`                                                                                                                    |
| `WindowLike`            | `{ readonly closed: boolean; readonly location: { assign(url: string): void }; open(url: string, target?: string, features?: string): WindowLike \| null }`                                                                              |
| `CheckoutHandlers`      | `CheckoutBaseHandlers & CheckoutStatusHandlers`: `{ onOpen?(url); onReturn?(hint); onBlocked?(url); onCancelled?(); onError?(error); onClose?(result) } & `{ onSuccess?(p); onFailed?(p); onExpired?(p) }`                               |
| `VerifyCheckout`        | `(reference: string) => Promise<VerifiedPayment>` — your backend, never the gateway                                                                                                                                                      |
| `CheckoutOptions`       | `(CheckoutBaseOptions & CheckoutStatusHandlers & { verify: VerifyCheckout }) \| (CheckoutBaseOptions & { verify?: never; onSuccess?: never; onFailed?: never; onExpired?: never })` — status callbacks are a type error without `verify` |     |
| `CheckoutResult`        | `{ outcome: CheckoutOutcome; url: string; reference: string \| null; payment: VerifiedPayment \| null }`                                                                                                                                 |
| `Checkout`              | `{ open(url: string, options?: { reference?: string }): Promise<CheckoutResult>; resume(href: string, options?: { reference?: string; expectedReference?: string }): Promise<CheckoutResult> }`                                          |
| `createCheckout`        | `(options?: CheckoutOptions) => Checkout`                                                                                                                                                                                                |
| `CheckoutHint`          | `{ reference: string \| null; statusHint: string \| null; referenceMatches: boolean; rawQuery: Record<string, string>; verified: false }`                                                                                                |
| `parseCheckoutResult`   | `(search: string, options?: { expectedReference?: string }) => CheckoutHint`                                                                                                                                                             |
| `formatAmount`          | `(amount: number, currency?: string, locale?: string) => string`                                                                                                                                                                         |
| `describePaymentStatus` | `(status: PaymentStatus) => string`                                                                                                                                                                                                      |

Lifecycle rules: `onOpen` fires once; `onReturn` fires only via `resume()`; status callbacks **only** fire when `verify` is configured (the return URL is a hint, never proof); `resume()` resolves `returned` when there is no reference or no `verify`; `onCancelled` covers closed/timeout/returned without a terminal status; `onClose` always fires last, exactly once, and no poll survives it.

## Provider-quirk invariants

These are behaviours of the provider, observed against a real account. Any
implementation that contradicts one of them is wrong, even if it type-checks.

1. **`tx_ref` is capped at 20 characters**, `[A-Za-z0-9._-]` only. The provider
   rejects anything longer or stranger. `createReference` must always fit.
2. **Duplicate handling is idempotency.** `tx_ref` is the de-duplication key: a
   repeat initiation with the same reference returns the existing payment rather
   than creating a second one, which is why a retried write is safe — and why
   reference reuse across _different_ payments is a data-loss bug.
3. **`is_settled: true` wins.** Whatever integer `status` says, a settled
   transaction is `succeeded`. `mapPaymentStatus` must apply this before
   anything else.
4. **`404` and `data: null` both mean "empty", not "error".** Settlement and
   transaction lookups return one or the other depending on the route. A
   single-record lookup resolves to `null`; a list resolves to `[]`.
5. **Verification is flaky.** `payments.verify` intermittently reports a
   still-pending payment for a transaction that has settled. Treat a non-terminal
   status as "retry later", never as "not paid", and never grant value from a
   webhook alone.
6. **Splits must total strictly less than 100%.** The merchant keeps the
   remainder. Reject at 100% or more locally with `MyImoPayValidationError`.
7. **Webhooks are unsigned by the provider.** Both production integrations put
   HMAC-SHA256 over the raw body on their own side. Deliveries that fail
   verification are rejected, and the raw body must be read before JSON parsing.
8. **There are no government endpoints.** Anything resembling a government
   agency, levy or revenue endpoint is out of scope for this SDK; do not add one.
