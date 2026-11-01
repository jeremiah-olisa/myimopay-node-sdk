<!-- @sdk-owner: A10-release -->

# Releasing

Two packages publish together from one repo: `myimopay` (server) and
`myimopay-browser` (keyless frontend helpers). `@myimopay/core` is private and
bundled into both `dist` trees, so it is never an install target.

## How versioning works

Versions come from [changesets](https://github.com/changesets/changesets) and
nowhere else. Do not hand-edit `version` in a `package.json`.

1. Any user-visible change gets a changeset:

   ```bash
   bun run changeset
   ```

   Commit the generated `.changeset/*.md` with the change.

2. `.changeset/config.json` lists both packages as `linked`, so they always carry
   the same version. `bun run version` (`changeset version`) bumps both, rewrites
   the changelogs, and deletes the consumed changesets. `@myimopay/core` is
   ignored: it is private and versioned only as an internal detail.

3. The release tag is `v<version>`. `.github/workflows/release.yml` refuses to
   publish if the tag does not equal both package versions, so a mismatched tag
   fails before anything reaches the registry.

## Before any release

```bash
bun run verify        # lint, typecheck, tests, universal-core, build, pkg, pack, browser
bun run check:knip    # advisory: dead files/exports
```

`verify` is the gate. `check:pack` is the one that proves the artifacts install
and load, so never skip it.

## Local publish

Local releasing needs **two independent credentials**. Neither substitutes for
the other:

| Step                                          | Tool     | Credential                                              |
| --------------------------------------------- | -------- | ------------------------------------------------------- |
| `npm publish`                                 | npm CLI  | npm login session or a granular npm token in `~/.npmrc` |
| `git push --follow-tags`, `gh release create` | `gh` CLI | GitHub token from `gh auth login`                       |

> `gh auth token` is a **GitHub** token. It authenticates to github.com and
> **cannot** authenticate to the npm registry. A release needs `npm login` (or an
> npm token) _and_ `gh auth login`.

### 1. Authenticate

```bash
npm login                 # interactive, per-user
# or, for CI-less automation, a granular token:
#   npmjs.com → Access Tokens → Generate New Token → Granular
#   packages: myimopay + myimopay-browser, permission: Read and write
echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}" >> ~/.npmrc

gh auth login             # GitHub, for the tag push and the release notes
npm whoami                # must print your npm username, not a GitHub one
```

### 2. Dry run first

```bash
bun run release:local --dry-run
```

It checks the versions, packs, and runs `npm publish --dry-run` for both
packages without writing to the registry, tagging, or pushing. Nothing is
mutated.

### 3. Publish

```bash
bun run release:local
```

In order, it: refuses a dirty tree or a branch other than `main`, runs
`bun run verify`, runs `changeset version`, asserts both packages carry the same
version, commits the bump and creates the annotated tag (the tag must point at a
commit that already contains the bumped `package.json`s, or the CI guard rejects
it), publishes both with `--access public`, then pushes `main` and the tag and
opens the GitHub release from generated notes. It aborts on the first failure, so
a red step means "nothing after this ran".

Useful flags: `--skip-verify` (iterate on the publish step), `--no-version`
(publish the versions already on disk).

Pushing the tag also triggers `.github/workflows/release.yml`. That is expected:
the workflow is idempotent — it skips `npm publish` when the version is already
on the registry and leaves an existing GitHub release alone — so a local release
does not leave a red run behind.

### Provenance caveat

`publishConfig.provenance` is `true`, but provenance is an OIDC attestation that
only exists inside a CI identity provider. A local publish cannot produce one, so
`release:local` passes `--provenance=false` and prints a reminder. Releases that
carry an attestation must go through the tag workflow below.

## CI publish (OIDC trusted publishing)

`.github/workflows/release.yml` runs on a `v*` tag:

1. `guard` — pinned actions, tag equals both package versions, then lint,
   typecheck, tests, universal-core, build, publint and arethetypeswrong.
2. `publish` — environment `npm`, `id-token: write`, and two
   `npm publish --provenance --access public` calls. **There is no `NPM_TOKEN`
   secret and no token fallback**: authentication is the OIDC identity itself.
3. `release` — `gh release create --generate-notes`.

### One-time setup, per package, on npmjs.com

Trusted publishing can only be configured on a package that already exists, so
the **first** version of each package has to be published locally (step 3 above).
After that:

1. npmjs.com → the package (`myimopay`, then `myimopay-browser`) →
   **Settings** → **Trusted publishing** → **GitHub Actions**.
2. Fill in:
   - Organization or user: `jeremiah-olisa`
   - Repository: `myimopay-node-sdk`
   - Workflow filename: `release.yml`
   - Environment: `npm`
3. Save. Repeat for the second package — the setting is per package, not per
   account, so a package without it will fail the publish step with a `404`/`403`.
4. In the GitHub repo, create the `npm` environment (Settings → Environments).
   Add required reviewers there if a human should approve each publish.

Publishing then only works from that workflow on a `v*` tag; nothing else can
push to those packages, and no long-lived npm token exists to steal.

## Cutting a release

```bash
bun run changeset          # describe the change (if not already done)
bun run version            # bump both packages + changelogs
git add -A && git commit -m "chore: release v$(node -p "require('./packages/node/package.json').version")"
git tag "v$(node -p "require('./packages/node/package.json').version")"
git push --follow-tags     # triggers .github/workflows/release.yml
```

## Verifying provenance

```bash
npm view myimopay dist.attestations    # present once published from CI
npm audit signatures                   # in a consumer project, checks the whole tree
```

The package page on npmjs.com also shows a "Built and signed on GitHub Actions"
badge with the attested commit. Attestations are immutable; if one is missing,
that release was published outside CI.

## Rollback and deprecation

Never unpublish a version people may have installed — it breaks their lockfiles.
In order of preference:

1. **Bad but installable** — deprecate it, publish a fix:

   ```bash
   npm deprecate myimopay@0.2.0 "Broken webhook verification; use 0.2.1"
   ```

2. **`latest` points at something wrong** — move the tag back:

   ```bash
   npm dist-tag add myimopay@0.1.0 latest
   npm dist-tag add myimopay-browser@0.1.0 latest
   ```

3. **Leaked secret or malicious code** — unpublish within npm's 72-hour window,
   then rotate the credential, then publish a patched version:

   ```bash
   npm unpublish myimopay@0.2.0
   ```

4. **GitHub side** — delete the release and the tag, and land the fix on `main`:

   ```bash
   gh release delete v0.2.0 --yes
   git push --delete origin v0.2.0
   git tag --delete v0.2.0
   ```

A rollback does not un-ring the bell: anything already published stays in
lockfiles, so a deprecation message plus a patched release is the only honest
remedy once a version is out.

## Known pre-release blockers

- The published `package.json` files still declare
  `"@myimopay/core": "workspace:*"`. `@myimopay/core` is private and already
  bundled into both `dist` trees, and `workspace:` cannot resolve from the
  registry, so that dependency must be dropped (or moved to `devDependencies`)
  before the first publish. `bun run check:pack` warns about it today.
