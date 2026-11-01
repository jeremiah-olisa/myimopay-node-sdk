# Provider notes

Where MyIMO Pay as observed disagrees with MyIMO Pay as documented. These are
the reasons several implementations look odd at first glance; do not "clean them
up" without re-testing against a real account.

## 1. Subaccount routes authenticate differently

Documented everywhere: `xp-key` carries the public key, `sp-key` carries the
secret key.

Observed on the subaccount routes: the provider accepts `Authorization` (Bearer,
secret) plus `mp-key`, and rejects the documented pair. The rest of the API —
pay initiation, verification, transactions, settlements, banks — uses `xp-key`
and `sp-key` as documented.

Consequence: `SubaccountsResource` bases its calls on the secret key, and
`MyImoPayConfig` has `publicKeyHeader`/`secretKeyHeader` overrides for
environments where the provider flips back.

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
"accepted but flagged".

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
webhook is a trigger to verify, never proof; and `is_settled: true` beats a
contradictory integer status.

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

- **Base hosts.** `client.ts` ships `https://api.myimopay.com` (live) and
  `https://api.staging.myimopay.com` (staging) as defaults. Confirm both against
  the provider dashboard before the first publish; `baseUrl` overrides them
  today.
- **Paging envelope.** The filter route accepts paging parameters, but the
  response shape for `total` is not documented and has been observed as both a
  number and a string. `TransactionPage` models it as `number | null`.
- **`payReference`.** Present on some transaction payloads and absent on others;
  origin undocumented.
