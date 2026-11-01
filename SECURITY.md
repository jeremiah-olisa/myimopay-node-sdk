# Security policy

## Reporting a vulnerability

Do not open a public issue. Email **security@myimopay.dev** with a description,
reproduction steps and the affected package version. You will get an
acknowledgement within 72 hours and a remediation plan within 7 days.

Do not test against production merchant accounts, and never send a real payer's
data in a report.

## Supported versions

| Version | Supported |
| ------- | --------- |
| `0.1.x` | Yes       |
| `< 0.1` | No        |

Once `1.x` ships, the latest two minor lines receive security fixes.

## Key handling expectations

This SDK is designed so that a leak is hard to cause and easy to notice.

- **The secret key is server-only.** `myimopay` throws on import under the
  `browser` export condition; `myimopay-browser` accepts no key at all. If you
  find a path that puts a key in a browser bundle, that is a vulnerability.
- **Keys never appear in errors, logs or debug events.** `toJSON()` on every
  error is redacted, and `DebugEvent` carries method, path, attempt, status and
  timing only. Report anything that prints a header value or a key.
- **Use the environment, not the source.** Read configuration through
  `configFromEnv(process.env)`; never commit `.env` (it is git-ignored).
- **Rotate on suspicion.** Keys are issued per environment; rotating the staging
  key costs nothing, so rotate first and investigate after.
- **Staging is not a sandbox.** It moves real money; set `maxAmount` on any
  non-production client.
- **Verify server-side.** A checkout return is a hint (`verified: false` forever)
  and a webhook is a trigger. Only `payments.verify` grants value.

## Dependency policy

`myimopay` and `myimopay-browser` ship with zero runtime dependencies, so the
supply-chain surface is the published tarballs themselves. Releases are built in
CI and published with provenance; a tarball that does not verify against this
repository should be treated as compromised.
