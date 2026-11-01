# House rules for agents

This repository is built by several agents in parallel against one frozen
contract. Read `docs/CONTRACTS.md` first; it wins over any assumption.

## Ownership

- Every file starts with two marker comments: `// @sdk-owner: <agent-id>` and
  `// @sdk-phase: <n>`. YAML, JSON and Markdown use `#`. Keep the marker you
  found; never replace another owner's file wholesale.
- The frozen public surface is `docs/CONTRACTS.md`. Adding to it is a
  cross-agent decision; changing a signature is a breaking release.

## Engineering defaults

- **YAGNI** — no option, hook, cache, plugin system or abstraction that no
  current caller needs. "We might need it later" is a no.
- **KISS** — the smallest thing that satisfies the contract. One transport, one
  error hierarchy, one place per default.
- **SOLID** — resources describe _what_, the transport does _how_. A resource
  never builds a URL or maps an HTTP status; the transport never decides what a
  payment status means.
- **DRY** — shared behaviour lives in `packages/core/src/utils`. If two resources
  need the same parsing, it belongs there, not copy-pasted.

## Imports

- Inside a package use relative paths (`./context`, `../watch`).
- Across packages use the workspace package name (`@myimopay/core`).
- In tests use the root aliases (`@core/utils/amount`, `@node/client`,
  `@browser/checkout`) instead of `../../..` chains.

## Hard constraints

- **No polling, no timers, no background loops.** Payment lifecycle is
  event-based (`payments.events.on` + `emit` from a verified webhook). A library
  that polls the provider invites duplicate load and self-DoS; reconciliation
  belongs to the caller's job scheduler.
- **`tx_ref` is capped at 20 characters** and is the provider's idempotency key.
  Validate it, never silently rewrite a caller's reference, and offer
  `sanitizeReference` for identifiers that do not fit.
- **Customer fields are provider-sensitive.** Names are normalised (punctuation,
  lone initials, single words) and an email is required by default, because the
  provider rejects the raw values in practice. Every normalisation is opt-out.
- **No new runtime dependencies.** `dependencies` stays empty except the
  workspace link. Node 20 ships `fetch`; the browser package uses `URL` and
  `URLSearchParams` only.
- **No `any`.** Unparseable provider payloads are `unknown` and are narrowed, not
  cast. `raw` stays `unknown` on every model.
- **No secrets in logs.** Nothing that leaves the process may contain a key: use
  `redact`/`redactHeaders`, and never put a key in a URL, error message or
  `DebugEvent`. `toJSON()` on errors is already safe.
- **No government endpoints.** Nothing that models a government agency, levy or
  revenue collection belongs in this SDK.
- **No `console`.** Diagnostics go through `onDebug` with `DebugEvent`.
- **Core stays runtime-neutral.** No `node:*` import may reach
  `packages/core`; it is bundled into the browser package.
- **`myimopay-browser` is keyless.** No function in it accepts, reads or stores
  a merchant key. If a feature needs one, it belongs on the server.

## Working agreement

- `bun run verify` is the gate. It is the only definition of "done".
- One changeset per user-visible change: `bun run changeset`.
- Stubs throw `not implemented: <name>`. Keep that shape until the workstream
  that owns the body lands, so nothing silently half-works.
- Prefer deleting code to adding options. A smaller surface is a feature.
