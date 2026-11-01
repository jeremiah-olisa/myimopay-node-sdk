<!-- @sdk-owner: A13-docs -->

# Provider notes

Where MyIMO Pay as observed disagrees with MyIMO Pay as documented. These are
the reasons several implementations look odd at first glance; do not "clean them
up" without re-testing against a real account.

## Observed, not documented

None of the following appears in the provider's published schema or integration
guide. Each one was observed against a real account and is encoded in this SDK;
re-check it before changing behaviour.

| Observation                               | What happens                                                        | Where the SDK handles it                                               |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `customer_full_name` rejects punctuation  | `"O'Brien-Okafor"`, `&`, `/`, accents and emoji are rejected        | `sanitizeCustomerName` (`customer.sanitizeName`, default on)           |
| A lone one-letter word is rejected        | `"H careplus"` is refused; `"Hcareplus"` is accepted                | `sanitizeCustomerName` merges it into its neighbour                    |
| A single-word name is rejected            | `"Techcourt"` is refused; two words are required                    | `sanitizeCustomerName` pads it to `"Techcourt Customer"`               |
| `customer_email` is effectively required  | The schema marks it optional; an initiation without one is rejected | `customer.requireEmail`, default `true`, fails locally first           |
| `tx_ref` is capped at 20 characters       | 21 characters is refused, whatever the schema says                  | `assertReference` / `createReference` (`MAX_REFERENCE_LENGTH`)         |
| Duplicate writes are reported as failures | A repeat `tx_ref` may answer `already initiated` / `already exists` | `DUPLICATE_REFERENCE`, and `ALREADY_COMPLETED` for `already completed` |
| `is_settled` outranks the integer status  | `status: 3` with `is_settled: true` is a settled payment            | `mapPaymentStatus(status, isSettled)` applies it first                 |
| `data: null` and `404` both mean "empty"  | A lookup can answer either, depending on route and day              | lists resolve to `[]`, single lookups to `null`                        |
| `verify` is flaky                         | It intermittently reports `pending` for a settled transaction       | non-terminal is "retry later", never "unpaid"                          |
| Splits must total strictly less than 100% | A 100% order is rejected after the payment is funded                | `assertSettlementPercentages` rejects locally                          |
| Webhooks carry no signature               | No provider digest, secret or timestamp header                      | caller-supplied HMAC over the raw body (`constructEvent`)              |
| There are no government endpoints         | Nothing models an agency, levy or revenue collection                | out of scope; do not add one                                           |

## 1. Entity routes: the published schema is not what production uses

The published schema describes the subaccount and settlement-order routes as
`Authorization` (Bearer, secret) plus `mp-key`. Production does not: those routes
accept the same pair as the rest of the API — `xp-key` plus `sp-key` — and the
SDK sends both (`auth: 'secret'`). The bank directory under `/vi/entities/banks`
is public and sends `xp-key` only.

Consequence: `SubaccountsResource` and `SettlementOrdersResource` use
`auth: 'secret'`; `BanksResource` uses `auth: 'public'`. `MyImoPayConfig` still
exposes `publicKeyHeader`/`secretKeyHeader` for a deployment where the provider
moves a credential, but there is no `Authorization`/`mp-key` code path to fall
back to.

## 2. The `uix-pky` UI verify key is unsupported

The provider's own UI uses a `uix-pky` header for client-side verification.
Treat it as unsupported: it is not a merchant credential, it is not documented,
and it is not accepted on the merchant verify route. Confirmed working:
`myimopay-browser` does not verify at all. Verification happens on the server
with `payments.verify`, and the browser package is keyless so there is nothing
to leak.

## 3. Webhooks are unsigned by the provider

There is no provider-issued webhook signature, no signing secret and no
timestamp header. Both production integrations instead compute an HMAC-SHA256
over the raw request body with a secret they share with the merchant's own
deployment, and reject a delivery whose digest does not match.

Consequence: the SDK verifies with the caller's `secret` (`WebhookOptions`),
not a provider key; the raw body must be read _before_ JSON parsing, and
`assertRawBodyString` exists because a framework that pre-parses the body makes
the digest unmatchable. An unsigned or mismatched delivery is rejected — never
"accepted but flagged". The verified event is then handed to
`payments.events`, whose subscriber re-reads the amount.

## 4. Provider errors can arrive as HTTP 200

A number of write routes answer `200 OK` with:

```json
{ "header": { "is_success": false, "remark": "..." }, "data": null }
```

Consequence: success is decided by `header.is_success`, never by the HTTP
status alone. `HttpClient` maps `is_success: false` to `MyImoPayApiError` even
when the transport status is 200, and maps `data: null` on a read route to an
empty result rather than an error.

## 5. Empty is not an error

Settlement and transaction lookups signal "nothing matched" with either a `404`
or a `200` carrying `"data": null`, depending on the route and the day.

Consequence: a single-record lookup resolves to `null`; a list resolves to `[]`.
Neither throws.

## 6. Verification is eventually consistent

`payments.verify` intermittently returns a pending status for a transaction that
has already settled, and `is_settled` can lag the balance by seconds.

Consequence: a non-terminal verify result means "retry later", not "unpaid"; a
webhook is a trigger to verify, never proof of amount; and `is_settled: true`
beats a contradictory integer status. Because verification is flaky, a caller
that must settle a payment after its event subscription has closed needs its own
retry loop in its own worker — the SDK no longer polls for you.

## 7. Splits cannot total 100%

Subaccount percentages on a settlement order must total strictly less than 100%,
because the merchant keeps the remainder. The provider rejects a 100% order after
the payment has already been funded, so `assertSettlementPercentages` rejects it
locally. `send-merchant-remainder` is the documented remedy.

## 8. Amounts are major units on the wire

The API takes and returns amounts in major units (naira), sometimes as numbers,
sometimes as numeric strings. This SDK normalises everything to `number` in major
units. The only exception is the initiation payload, which is serialised as a
fixed-point string so no float rounding creeps in.

## Open questions

- **Base hosts.** `DEFAULT_BASE_URLS` is
  `https://apipg.demo.myimopay.com` (staging) and
  `https://api.myimopay.com` (live). Confirm both against the provider dashboard
  before the first publish; `baseUrl` overrides them today. There is no
  `api.staging.myimopay.com` host — that name appears in no provider material and
  does not resolve.
- **Paging envelope.** The filter route accepts paging parameters, but the
  response shape for `total` is not documented and has been observed as both a
  number and a string. `TransactionPage` models it as `number | null`.
- **`payReference`.** Present on some transaction payloads and absent on others;
  origin undocumented.
- **Staging moves real money.** MyIMO Pay's integration instructions say so.
  Treat staging as production until the provider confirms otherwise, and
  re-check before a test run.
