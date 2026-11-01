# Contributing

## Setup

```bash
bun install
bun run verify
```

Lefthook wires Biome, commitlint and the pre-push gate automatically on
`bun install`. If hooks did not install, run `bunx lefthook install`.

## The gate

```bash
bun run verify
```

That runs, in order: `lint`, `typecheck`, `test:coverage` (85% floor),
`check:universal` (core imports no Node built-in), `build`, `check:pkg`
(publint + are-the-types-wrong), `check:pack` (tarball smoke test) and
`check:browser` (browser bundle audit). A pull request that fails any step is
not reviewable — fix the gate, not the check.

Individual steps: `bun run lint`, `bun run typecheck`, `bun test`,
`bun run check:size`, `bun run check:knip`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), enforced by
commitlint: `type(scope): summary`.

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`,
  `perf`, `revert`.
- Scopes: `core`, `node`, `browser`, `docs`, `ci`, `deps`, `release`, `repo`,
  `tooling`.
- The subject is imperative and under 100 characters: `fix(node): retry verify
  on a pending status`.

## Branches

`<type>/<scope>-<short-slug>`, e.g. `feat/core-amount-normalisation` or
`fix/node-duplicate-reference`. `main` is protected; merge through a squashed PR
whose title is already a conventional commit.

## Changesets

Every user-visible change needs one:

```bash
bun run changeset
```

Pick the affected packages and a bump type. `myimopay` and `myimopay-browser`
are linked, so they always version together; `@myimopay/core` is private and is
not versioned. Docs-only and CI-only changes do not need a changeset.

## Style

- Biome owns formatting and linting: `bun run lint:fix`.
- TSDoc on every exported symbol. Explain _why_ the constraint exists, not what
  the types already say.
- No new runtime dependencies. See `AGENTS.md`.
