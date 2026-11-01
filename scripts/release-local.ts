// @sdk-owner: A10-release
// @sdk-phase: 6

/**
 * Local, token-based release.
 *
 * Two independent credentials are involved and neither substitutes for the
 * other: npm authenticates the *publish* (`npm login` or a granular token in
 * `~/.npmrc`), while GitHub authenticates the tag push and the release (`gh`
 * or a GitHub token). `gh auth token` is a GitHub token — it cannot publish to
 * npm.
 *
 * Provenance needs OIDC, which only exists inside CI, so a local publish cannot
 * produce an attestation. Use `.github/workflows/release.yml` for the release
 * that ships to the registry.
 *
 * Usage:
 *   bun run release:local --dry-run          # everything except mutations
 *   bun run release:local                    # verify, version, publish, tag, release
 *   bun run release:local --skip-verify      # iterate on the publish step
 *   bun run release:local --no-version       # publish the versions already on disk
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOT = dirname(import.meta.dir);

const PUBLISHED = ['myimopay', 'myimopay-browser'] as const;
type PackageName = (typeof PUBLISHED)[number];

const PACKAGE_DIRS: Readonly<Record<PackageName, string>> = {
  myimopay: 'packages/node',
  'myimopay-browser': 'packages/browser',
};

interface Options {
  readonly dryRun: boolean;
  readonly skipVerify: boolean;
  readonly skipVersion: boolean;
}

const KNOWN_FLAGS = new Set(['--dry-run', '--skip-verify', '--no-version']);

function parseOptions(argv: readonly string[]): Options {
  const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg));

  if (unknown.length > 0) {
    console.error(`release:local: unknown option(s): ${unknown.join(', ')}`);
    console.error('  supported: --dry-run, --skip-verify, --no-version');
    process.exit(1);
  }

  return {
    dryRun: argv.includes('--dry-run'),
    skipVerify: argv.includes('--skip-verify'),
    skipVersion: argv.includes('--no-version'),
  };
}

function heading(text: string): void {
  console.log(`\n▸ ${text}`);
}

function info(text: string): void {
  console.log(`  ${text}`);
}

function warn(text: string): void {
  console.log(`  ! ${text}`);
}

function abort(message: string, hint?: string): never {
  console.error(`\n✘ ${message}`);
  if (hint !== undefined) console.error(`  ${hint}`);
  process.exit(1);
}

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function capture(command: string[]): Promise<CommandResult> {
  const child = Bun.spawn(command, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(''),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(''),
  ]);
  const code = await child.exited;

  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function stream(command: string[]): Promise<number> {
  const child = Bun.spawn(command, {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  return await child.exited;
}

async function readVersion(name: PackageName): Promise<string> {
  const raw = await readFile(join(ROOT, PACKAGE_DIRS[name], 'package.json'), 'utf8');
  const manifest = JSON.parse(raw) as { version?: string };

  if (typeof manifest.version !== 'string' || manifest.version === '') {
    abort(`${PACKAGE_DIRS[name]}/package.json has no version.`);
  }

  return manifest.version;
}

/**
 * Commits the changesets bump and tags it.
 *
 * The tag has to point at a commit that already contains the bumped
 * `package.json`s: `.github/workflows/release.yml` re-reads the versions from the
 * tagged tree and refuses to publish when they disagree with the tag.
 */
async function commitVersionBump(version: string): Promise<void> {
  const status = await capture(['git', 'status', '--porcelain']);

  if (status.code !== 0) abort(`git status failed: ${status.stderr}`);

  if (status.stdout === '') {
    info('nothing to commit — the versions on disk were already released');
  } else {
    info('committing the version bump so the tag points at the published code');

    const added = await capture(['git', 'add', '--all', 'packages', '.changeset']);

    if (added.code !== 0) abort(`git add failed: ${added.stderr}`);

    const staged = await capture(['git', 'diff', '--cached', '--quiet']);

    if (staged.code !== 0) {
      const committed = await capture(['git', 'commit', '-m', `chore: release v${version}`]);

      if (committed.code !== 0) {
        abort(
          `git commit failed: ${committed.stderr}`,
          'commit hooks may be blocking it; fix the hook, then rerun.',
        );
      }

      info('committed');
    }
  }

  const existing = await capture(['git', 'tag', '--list', `v${version}`]);

  if (existing.stdout === '') {
    const tagged = await capture(['git', 'tag', '-a', `v${version}`, '-m', `myimopay ${version}`]);

    if (tagged.code !== 0) abort(`git tag failed: ${tagged.stderr}`);

    info(`tagged v${version}`);
  } else {
    info(`tag v${version} already exists`);
  }
}

/** The tree must be the reviewed, committed state — otherwise the tag lies. */
async function assertReleaseReady(): Promise<void> {
  heading('Checking the working tree');

  const branch = await capture(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);

  if (branch.code !== 0) {
    abort('not a git repository.', 'release:local tags and pushes, so it needs a checkout.');
  }

  if (branch.stdout !== 'main') {
    abort(
      `on branch "${branch.stdout}", not "main".`,
      'merge first: tags are cut from main so the published code is the reviewed code.',
    );
  }

  info(`branch: ${branch.stdout}`);

  const status = await capture(['git', 'status', '--porcelain']);

  if (status.code !== 0) abort(`git status failed: ${status.stderr}`);

  if (status.stdout !== '') {
    const dirty = status.stdout.split('\n').slice(0, 10).join('\n    ');
    abort('the working tree has uncommitted changes.', `commit or stash them first:\n    ${dirty}`);
  }

  info('working tree: clean');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  console.log('myimopay release:local');
  if (options.dryRun) {
    console.log('  mode: DRY RUN — no commit, tag, push, release or registry write happens');
  }

  if (!options.dryRun) {
    await assertReleaseReady();
  } else {
    heading('Checking the working tree');
    info('skipped in dry-run (a release needs a clean main)');
  }

  if (options.skipVerify) {
    heading('Verification');
    warn('skipped (--skip-verify)');
  } else {
    heading('Verifying (bun run verify)');
    info('lint, typecheck, tests, universal-core, build, package checks, tarball, browser');
    const code = await stream(['bun', 'run', 'verify']);

    if (code !== 0) {
      abort('verification failed.', 'fix it, or pass --skip-verify only when iterating locally.');
    }

    info('verified');
  }

  if (options.skipVersion) {
    heading('Versioning');
    warn('skipped (--no-version)');
  } else if (options.dryRun) {
    heading('Versioning');
    warn('skipped in dry-run: `changeset version` rewrites package.json and CHANGELOG files');
  } else {
    heading('Versioning (changeset version)');
    info('bumps both linked packages and writes the changelogs');
    const code = await stream(['bun', 'run', 'version']);

    if (code !== 0) abort('changeset version failed.');
  }

  heading('Reading versions');

  const version = await readVersion('myimopay');
  const browserVersion = await readVersion('myimopay-browser');

  if (version !== browserVersion) {
    abort(
      `the packages are linked but out of step: myimopay ${version}, myimopay-browser ${browserVersion}.`,
      'they publish together; run `bun run version` so changesets bumps both.',
    );
  }

  info(`myimopay ${version}`);
  info(`myimopay-browser ${browserVersion}`);

  if (options.dryRun) {
    heading('Tagging');
    info(`would commit the version bump and tag v${version}`);
  } else {
    heading(`Tagging v${version}`);
    await commitVersionBump(version);
  }

  heading(`Publishing ${version} to npm`);
  warn('provenance requires CI: a local publish cannot produce an attestation.');
  warn('run the tag workflow (.github/workflows/release.yml) for an attested release.');

  for (const name of PUBLISHED) {
    // `publishConfig.provenance` is true, but the OIDC identity that produces the
    // attestation only exists in CI; disable it locally instead of failing late.
    const command = [
      'npm',
      'publish',
      '--workspace',
      name,
      '--access',
      'public',
      '--provenance=false',
    ];

    if (options.dryRun) command.push('--dry-run');

    info(`${command.join(' ')}`);
    const code = await stream(command);

    if (code !== 0) {
      abort(
        `npm publish failed for ${name}.`,
        'check `npm whoami` and the registry in ~/.npmrc — a GitHub token cannot publish to npm.',
      );
    }
  }

  if (options.dryRun) {
    heading('GitHub release');
    info('skipped in dry-run: would run `git push --follow-tags` and');
    info(`  gh release create v${version} --generate-notes`);
    console.log(`\n✔ dry run complete — nothing was published, tagged or pushed.`);
    return;
  }

  heading('Pushing the tag and creating the GitHub release');
  info(`pushing main and v${version} (the tag is what CI releases from)`);
  const pushed = await stream(['git', 'push', '--follow-tags']);

  if (pushed !== 0)
    abort('git push --follow-tags failed.', 'the npm packages are already published.');

  const released = await capture([
    'gh',
    'release',
    'create',
    `v${version}`,
    '--generate-notes',
    '--verify-tag',
  ]);

  if (released.code !== 0) {
    abort(
      `gh release create v${version} failed: ${released.stderr}`,
      'the tag is pushed; rerun that command once gh is authenticated.',
    );
  }

  console.log(`\n✔ released ${version}`);
  console.log('  npm:     https://www.npmjs.com/package/myimopay');
  console.log('  npm:     https://www.npmjs.com/package/myimopay-browser');
  console.log(`  release: ${released.stdout || `v${version}`}`);
  console.log(
    '  note:    this run is not attested. Use the tag workflow for provenance next time.',
  );
}

await main();
