<!-- @sdk-owner: A13-docs -->

# Security

This SDK is built so that leaking a merchant key is hard to do by accident and
easy to notice when it happens. Everything below is enforced by code, not by
convention.

## Key handling

| Key         | Where it lives                 | What it can do                                               |
| ----------- | ------------------------------ | ------------------------------------------------------------ |
| `publicKey` | `myimopay` config, server only | Initiate payments, verify, read transactions and settlements |
| `secretKey` | `myimopay` config, server only | Everything above, plus subaccounts and settlement orders     |

Rules the code already applies:

- **No key parameter exists in `myimopay-browser`.** Not in `createCheckout`,
  not in `open`, not in `resume`.
- **`myimopay` throws on import under the `browser` export condition**
  (`SERVER_ONLY`), so a bundler that resolves the condition fails loudly instead
  of shipping a key. Constructing a client where `globalThis.window` exists
  throws the same code.
- **Keys are never passed per call.** `RequestOptions` has no credential field;
  a key cannot travel with one request by mistake.
- **Keys are trimmed and length-checked at construction** (`INVALID_CONFIG`), so
  a half-pasted key fails at boot rather than at the first payment.
- **Credential and transport headers are reserved.** Per-call `headers` cannot
  set a credential name (`xp-key`, `sp-key` and their overrides) or `host`,
  `content-length`, `content-type`, `authorization`, `connection`,
  `transfer-encoding`, `cookie` or `set-cookie`. The config-level `headers`
  option rejects the smaller set `host`, `content-length`, `content-type` and
  `authorization`, but even a credential name set there is harmless: the
  transport writes credentials last, so nothing can replace them. Line breaks are
  rejected on both paths, so header injection is not possible.

Read configuration from the environment, not from source:

```ts
const client = MyImoPay.fromEnv(process.env); // MYIMOPAY_PUBLIC_KEY, MYIMOPAY_SECRET_KEY
```

Never commit `.env` (git-ignored), never paste a key into a client bundle, never
put a key in a URL — worker request logs retain query strings indefinitely.

## Header model

| Header   | Carries             | Sent when                            |
| -------- | ------------------- | ------------------------------------ |
| `xp-key` | merchant public key | `auth: 'public'` or `auth: 'secret'` |
| `sp-key` | merchant secret key | `auth: 'secret'` only                |

Both names are overridable with `publicKeyHeader` / `secretKeyHeader` (lowercase,
`[a-z0-9-]` only, and never one of the reserved names above). Every entity call
— banks, subaccounts, settlement orders, settlements, transactions — and every
payment route uses this pair: `auth: 'public'` sends `xp-key`, and
`auth: 'secret'` sends `xp-key` plus `sp-key`. That includes the subaccount and
settlement-order routes, which the provider's published schema describes as
`Authorization` + `mp-key`; production does not use that scheme, so the SDK does
not either. The header overrides exist for a deployment that genuinely moves the
credential, not to patch the transport.

The provider's UI key (`uix-pky`) is unsupported and deliberately absent. It is
not a merchant credential and it is not accepted on the verify route. Client-side
verification does not exist here: verification happens on your server.

## Why the browser package is keyless

MyIMO Pay's own integration guidance is that the merchant key belongs on the
server. A key in a browser bundle is on every visitor's disk, in every CDN cache
and in every error report the browser sends; it cannot be rotated retroactively
for sessions already running.

So `myimopay-browser` only opens a hosted page by URL, reads a query string and
formats numbers. It cannot initiate, verify or charge anything. When it needs to
know whether a payment succeeded, it calls a function you supply — normally your
own endpoint wrapping `payments.verify`:

```ts
const checkout = createCheckout({
  mode: 'redirect',
  verify: async (reference) => {
    const response = await fetch(`/api/payments/${encodeURIComponent(reference)}`);
    if (!response.ok) throw new Error('verification failed');
    return response.json();
  },
});
```

The endpoint, not the browser, decides what `succeeded` means.

## Redaction guarantees

`redact`, `redactHeaders` and `maskValue` are deny-by-default: a value is masked
when it _looks_ like a credential, not only when its field name is on a list.

- Header names matching `xp-key`, `sp-key`, `mp-key`, `uix-pky`,
  `authorization`, `cookie`, `set-cookie` (case-insensitive, separator optional)
  are always masked.
- Bare values shaped like `Bearer <token>` or a 16+ character opaque token are
  masked wherever they appear.
- Media types (`application/json`) are exempt, so a `content-type` header is not
  mangled.
- `maskValue` keeps four leading and four trailing characters (`abcd***wxyz`) so
  a support ticket can still correlate, and returns `***` for short values.
- Cycles become `[Circular]`; an unserialisable value becomes
  `[Unserializable]`. Redaction never throws.

Applied automatically to: `MyImoPayApiError.body`, every `DebugEvent.message`, and
every error `message` as it leaves the transport. `MyImoPayApiError.body` keeps
unknown provider fields — it is redacted, not stripped. `toJSON()` omits `body`
entirely, so the safe thing to log is also the small thing to log.

`DebugEvent` itself carries only `type`, `method`, `path`, `attempt`, `status`,
`durationMs` and `message`. There is no header dump and no body dump, so a
`onDebug` hook cannot leak a key by accident. `onDebug` throws are swallowed: a
diagnostics hook must never break a live payment.

## TLS only, no redirects

- Every request URL is built from an https base URL. A non-https or unparseable
  base throws `VALIDATION_ERROR` / `INVALID_CONFIG`; there is **no insecure
  escape hatch**, not even for tests (inject `fetch` instead).
- `callbackUrl` and the configured `baseUrl` reject embedded credentials, so a
  password cannot ride into an error message or a log line.
- Requests are issued with `redirect: 'error'`. A redirect is a failure, not
  something to follow: following one would replay merchant credentials to
  whatever host the response named.
- Responses are capped at 1 MiB and must be JSON; anything else is
  `MALFORMED_RESPONSE` rather than an unbounded read.

## Webhook verification

MyIMO Pay does **not** sign webhooks. There is no provider-issued signature, no
signing secret and no timestamp header. The SDK therefore authenticates a
delivery with a secret shared between the provider-side deployment and your
endpoint:

1. Read the **raw bytes** before any JSON parsing (`readRawBody(stream)`,
   `express.raw({ type: 'application/json' })`, `await req.text()`).
2. Compute `HMAC-SHA256(secret, rawBody)` and hex-encode it.
3. Compare it to the header value, **case-insensitively**, in constant time.
4. Emit the verified event into `payments.events`
   (`await client.payments.events.emit(event)`) and answer `200`. The subscriber
   that created the payment is the only place value is granted.

`verifyWebhookSignature` does exactly that with `timingSafeEqual`, rejects a
missing/empty/malformed digest, an empty secret and an empty body, and never
throws. `constructEvent` calls it first: an unverified delivery is never parsed
into an event. `signWebhookPayload` produces the digest your tests and local
replays should send.

An empty `secret` is rejected rather than treated as "nothing to check" —
accepting an unsigned delivery would let anyone POST a payment success. A
delivery that fails verification is rejected, never "accepted but flagged".

## Replay and terminality

- **A webhook is a trigger, not proof.** Authenticate the delivery, emit it to
  `payments.events`, and let the subscriber re-read the amount from your own
  records or `payments.verify` before granting value. A forged or replayed
  delivery then costs you one extra API call, not a free order.
- **The bus already drops a re-delivered terminal event.** `emit` returns `0`
  for a duplicate, for a non-terminal status, and for a reference the process is
  not subscribed to, and a subscription cannot deliver twice. That is a
  per-process guard, not a ledger: it does not survive a restart and it does not
  span instances, so keep your own idempotent write keyed by `reference`.
- **Deduplicate on `eventId`** as well when the provider sends one (`event.id` or
  `event.identifier`). The reference alone is not a delivery id: the same payment
  produces several notifications (initiated → pending → succeeded).
- **Treat a terminal status as terminal.** `succeeded`, `failed` and `expired`
  must not be reconciled again; re-granting value on a replayed `succeeded` is
  the classic double-credit bug.
- **A non-terminal verify is "ask again later".** Verification is eventually
  consistent; `pending` is not `unpaid`.
- **`is_settled: true` is the strongest signal** and beats a contradictory
  integer status, in verification and in webhooks alike.
- **Webhook bodies are capped at 1 MiB** (`readRawBody`) and rejected above it.
- **Subscription state is in memory.** Default TTL 30 minutes, at most 10 000
  live subscriptions. Nothing is written to disk, so a restart loses pending
  subscriptions: the webhook that follows returns `0`, and your own store is the
  only place the outcome still exists.

## Never do this

- Put `MYIMOPAY_SECRET_KEY` (or any key) in a browser bundle, a `NEXT_PUBLIC_*`
  variable, a mobile app or a public repo.
- Call `payments.verify` from the browser "just to check" — the key would have to
  ship with it.
- Grant value from a checkout return URL, a query string, or a webhook body. All
  three are attacker-controlled until the server verifies.
- Log `error.body` raw instead of `error.toJSON()`, or log request headers.
- Re-serialise a parsed webhook body before verifying it — key order and
  whitespace change and the digest can never match.
- Reuse one `tx_ref` for two different payments: the provider treats a repeated
  reference as the same payment and returns the first one.
- Point `baseUrl` at plain http, an IP with a self-signed certificate, or a proxy
  that rewrites bodies to "make it work".
- Add a government agency, levy or revenue endpoint. Nothing in this SDK models
  one, and nothing should.
- Assume staging is safe. MyIMO Pay's integration instructions state that
  staging transactions move real money. Treat staging as production until the
  provider confirms otherwise, and re-check before a test run; set `maxAmount` on
  every non-production client.
