<!-- @sdk-owner: A13-docs -->

# Error catalogue

Every failure in this SDK is a `MyImoPayError` subclass with a `code` from
`MyImoPayErrorCode`. Nothing throws a bare string, an Axios error or a provider
payload. Use `isMyImoPayError(value)` rather than `instanceof` — a dependency
tree can hold two copies of the package and `instanceof` then returns false.

```ts
import { isMyImoPayError } from 'myimopay';

try {
  await client.payments.verify(reference);
} catch (error) {
  if (!isMyImoPayError(error)) throw error;
  switch (error.code) {
    case 'RATE_LIMITED':
      /* back off and retry later */
      break;
    default:
      throw error;
  }
}
```

## Classes

| Class                     | Extra fields beyond `code`/`message`    | When                                                       |
| ------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| `MyImoPayError`           | —                                       | Base class; also used for codes with no dedicated subclass |
| `MyImoPayValidationError` | `field: string \| null`                 | Caller input rejected before any network call              |
| `MyImoPayApiError`        | `status`, `remark`, `requestId`, `body` | The provider answered with a failure                       |
| `MyImoPayNetworkError`    | — (carries `cause`)                     | DNS, connection reset, TLS, fetch rejection                |
| `MyImoPayTimeoutError`    | — (carries `cause`)                     | One attempt exceeded `timeoutMs`                           |
| `MyImoPayWebhookError`    | —                                       | A delivery could not be authenticated or parsed            |

`toJSON()` on any error is safe to log: it emits `name`, `code`, `message` and,
for API errors, `status`/`remark`/`requestId`. It never contains a credential.

## The codes

| Code                        | Raised when                                                                                                                                                                          | Corresponding HTTP status                     | Fix                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`          | A caller value fails a local rule: amount shape, reference length, phone, email, https URL, customer name, settlement percentages, empty id, empty event reference, and so on        | none — local. A provider `400` also maps here | Read `error.field` and fix the input. Nothing was sent, so retrying the same call cannot succeed                                                                                         |
| `INVALID_CONFIG`            | `new MyImoPay(config)`, `with()` or `fromEnv()` rejects a config value; also `auth: 'secret'` with no `secretKey`                                                                    | none — local, thrown from the constructor     | Fix the config. The message names the field and the rule; it never echoes a key                                                                                                          |
| `INVALID_API_KEY`           | The provider answers `401` or `403`                                                                                                                                                  | `401`, `403`                                  | The public or secret key is wrong, revoked or belongs to the other environment. Rotate and redeploy                                                                                      |
| `MISSING_API_KEY`           | The provider answers `412`                                                                                                                                                           | `412`                                         | A required key header was absent. Check `publicKey`/`secretKey` and any `publicKeyHeader`/`secretKeyHeader` override                                                                     |
| `FORBIDDEN`                 | Never raised by the current transport: `403` maps to `INVALID_API_KEY`                                                                                                               | —                                             | Kept in the union for compatibility. Do not write a branch that only `FORBIDDEN` can reach                                                                                               |
| `NOT_FOUND`                 | The provider answers `404` and the resource does not treat it as "empty"                                                                                                             | `404`                                         | The id or reference does not exist. Lookup helpers (`findByReference`, `findById`, `directByReference`, `splitByReference`, settlement lists) resolve to `null`/`[]` instead of throwing |
| `CONFLICT`                  | The provider answers `409` — typically a duplicate bank code + account number on subaccount creation                                                                                 | `409`                                         | Fetch the existing record (`subaccounts.list`) instead of creating a second one                                                                                                          |
| `DUPLICATE_REFERENCE`       | The provider rejects a repeat write with a remark containing `already initiated`, `duplicate` or `already exists` (`400`, or `200` with `is_success: false`)                         | `400`, or `200` with a failure envelope       | Expected and safe: `tx_ref` is the de-duplication key, so the payment already exists. Verify that reference and continue; never mint a new reference for the same payment                |
| `ALREADY_COMPLETED`         | The provider remark contains `already completed`                                                                                                                                     | `400`, or `200` with a failure envelope       | The operation already ran. Read current state (`payments.verify`, `settlements.*`) instead of repeating it                                                                               |
| `MERCHANT_NOT_READY`        | The provider answers `422` — account not activated, KYC incomplete, subaccount not approved                                                                                          | `422`                                         | Fix the merchant account in the dashboard. Retrying does not help until the account is activated                                                                                         |
| `RATE_LIMITED`              | The provider answers `429`; retried automatically on GET and de-duplicated writes                                                                                                    | `429`                                         | Let the built-in retry run, then slow down. Honour `retry-after` (the transport does)                                                                                                    |
| `PROVIDER_ERROR`            | Any other non-2xx status, and a `2xx` carrying `header.is_success: false` with an unrecognised remark                                                                                | any other `4xx`/`5xx`, or `200`               | Read `status`, `remark`, `requestId` and `body`. A `200` here means the provider reported failure inside a success status                                                                |
| `MALFORMED_RESPONSE`        | A `2xx` whose body is empty, not JSON, over 1 MiB, missing `data`, or not the shape the route promises (including an initiation with no `payment_link`)                              | `2xx`                                         | Treat as a provider incident. Log `error.message`; do not grant value. Settlement reads turn the "no data" case into `[]`/`null`                                                         |
| `NETWORK_ERROR`             | `fetch` rejects before a response arrives (DNS, reset, TLS, offline)                                                                                                                 | none                                          | Retried automatically on GET and de-duplicated writes. If it survives the retry budget, surface it and reconcile later                                                                   |
| `TIMEOUT_ERROR`             | One attempt exceeds `timeoutMs`                                                                                                                                                      | none                                          | Retried like `NETWORK_ERROR`. Raise `timeoutMs` (max 120000) only if the route is genuinely slow                                                                                         |
| `ABORTED`                   | The caller's `AbortSignal` fired                                                                                                                                                     | none                                          | Intentional. Do not retry an abort the caller asked for                                                                                                                                  |
| `WEBHOOK_SIGNATURE_INVALID` | `constructEvent`/`verifyWebhookSignature`/`signWebhookPayload` found a missing, malformed, empty-secret or mismatched HMAC, a non-JSON body, or a body with no transaction reference | none — thrown in your handler                 | Answer `401` and process nothing. Check that the body was read raw, before JSON parsing, and that both sides share the same secret                                                       |
| `SERVER_ONLY`               | `myimopay` was imported through the `browser` export condition, or a client was constructed where `globalThis.window` exists                                                         | none                                          | Move the call to the server. Use `myimopay-browser` on the client; it is keyless                                                                                                         |
| `UNKNOWN`                   | A non-SDK value surfaced inside the transport (wrapped, original kept as `cause`), or the unreachable end of the retry loop                                                          | none                                          | Report it with `error.cause`. It means something outside the SDK threw                                                                                                                   |

## Customer field rejections

A missing email is a `VALIDATION_ERROR` with `field: 'customer.email'`, raised
before the request leaves the process. The message is:

```text
customer.email is required: MyIMO Pay rejects initiations without one in practice. Pass customer.email, set customer.emailFallbackDomain to derive one from the phone, or set customer.requireEmail to false if you have verified your flow needs none.
```

Three ways out, in order of preference: pass `customer.email`; set
`customer.emailFallbackDomain` so the SDK derives `<phone>@domain`; or set
`customer.requireEmail: false` once you have confirmed your flow works without
one.

A malformed address is `VALIDATION_ERROR` with the message
`customer.email is not a valid email address.`. A name that is empty or only
whitespace is rejected as `customer.fullName`, but the default `sanitizeName`
policy repairs punctuation, lone one-letter words and single-word names instead
of failing — see [api.md](api.md#customer-policy).

## Handling duplicate references and already-completed payments

Both codes describe a **successful outcome reported as a failure**. The correct
response is the same in both cases: stop creating, start reading.

```ts
try {
  const payment = await client.payments.initiate({
    amount: 1500,
    reference: order.reference, // stable per order, max 20 chars
    customer: {
      fullName: order.customerName,
      mobile: order.customerPhone,
      email: order.customerEmail,
    },
  });
  return payment.authorizationUrl;
} catch (error) {
  if (!isMyImoPayError(error)) throw error;
  if (error.code === 'DUPLICATE_REFERENCE') {
    const existing = await client.payments.verify(order.reference);
    return existing.raw; // or re-read the stored authorization URL
  }
  throw error;
}
```

A repeated initiation with the same `tx_ref` returns the existing payment rather
than creating a second one — which is why retrying a write is safe, and why
reusing a reference for a _different_ payment is a data-loss bug.

## Reading an API error

```ts
if (error instanceof MyImoPayApiError) {
  error.status; // HTTP status of the final attempt
  error.remark; // provider's own wording, already redacted
  error.requestId; // from x-request-id / x-trace-id / x-correlation-id, or null
  error.body; // parsed provider body, passed through redact()
}
```

`error.body` is redacted, not sanitised for shape: unknown provider fields are
preserved so a support ticket can quote them.
