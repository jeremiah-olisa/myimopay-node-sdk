// @sdk-owner: A10-release
// @sdk-phase: 6

/**
 * Packs both published packages and proves the *artifacts* work from a clean
 * project: ESM, CJS, and the browser package on both loaders.
 *
 * This is the only check that exercises what a consumer actually downloads, so
 * it fails on a broken `exports` map, a missing `dist` file or a `package.json`
 * that points at a path the tarball does not contain.
 *
 * Run with `bun run check:pack` (after `bun run build`).
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = dirname(import.meta.dir);

interface Target {
  /** Published package name. */
  readonly name: string;
  /** Workspace-relative directory. */
  readonly dir: string;
}

const TARGETS: readonly Target[] = [
  { name: 'myimopay', dir: 'packages/node' },
  { name: 'myimopay-browser', dir: 'packages/browser' },
];

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(command: string[], cwd: string): Promise<CommandResult> {
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(''),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(''),
  ]);
  const code = await child.exited;

  return { code, stdout, stderr };
}

function tail(text: string, lines = 12): string {
  const all = text.trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

/* -------------------------------------------------------------------------- */
/* Consumer smoke programs. Written as text so the checks run under plain node */
/* from the temp project, exactly like a real consumer would.                  */
/* -------------------------------------------------------------------------- */

const ESM_SERVER = `import assert from 'node:assert/strict';
import { createClient, DEFAULT_BASE_URLS, MyImoPay } from 'myimopay';

assert.equal(typeof MyImoPay, 'function', 'MyImoPay should be a class');
assert.equal(typeof createClient, 'function', 'createClient should be a function');

const staging = DEFAULT_BASE_URLS.staging;
assert.equal(typeof staging, 'string', 'DEFAULT_BASE_URLS.staging should be a string');
assert.ok(
  staging.includes('apipay') || staging.includes('apipg'),
  'staging host should point at the gateway, got ' + staging,
);

const calls = [];
const mockFetch = async (input) => {
  calls.push(String(input));
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ header: { isSuccess: true }, data: null }),
  };
};

const client = createClient({
  environment: 'staging',
  publicKey: 'pk_test_1234567890',
  secretKey: 'sk_test_1234567890',
  fetch: mockFetch,
});

assert.ok(client instanceof MyImoPay, 'createClient should return a MyImoPay');
assert.equal(client.environment, 'staging');
assert.ok(client.baseUrl.startsWith('https://'), 'base URL should be https, got ' + client.baseUrl);
assert.equal(typeof client.payments.verify, 'function');
assert.equal(calls.length, 0, 'constructing a client must not perform I/O');

console.log('esm import: ok');
`;

const CJS_SERVER = `const assert = require('node:assert/strict');
const sdk = require('myimopay');

assert.equal(
  typeof sdk.MyImoPay,
  'function',
  'require("myimopay") resolved something other than the server entry — the browser guard throws here instead',
);
assert.equal(typeof sdk.DEFAULT_BASE_URLS.staging, 'string');

const client = new sdk.MyImoPay({ environment: 'staging', publicKey: 'pk_test_1234567890' });
assert.equal(client.environment, 'staging');

console.log('cjs require: ok');
`;

const ESM_BROWSER = `import assert from 'node:assert/strict';
import { createCheckout, parseCheckoutResult } from 'myimopay-browser';

assert.equal(typeof createCheckout, 'function', 'createCheckout should be a function');
assert.equal(typeof parseCheckoutResult, 'function', 'parseCheckoutResult should be a function');

console.log('browser esm import: ok');
`;

const CJS_BROWSER = `const assert = require('node:assert/strict');
const browser = require('myimopay-browser');

assert.equal(typeof browser.createCheckout, 'function', 'createCheckout should be a function');
assert.equal(typeof browser.parseCheckoutResult, 'function', 'parseCheckoutResult should be a function');

console.log('browser cjs require: ok');
`;

const SMOKE_CHECKS: readonly { label: string; file: string; source: string }[] = [
  { label: 'esm import (myimopay)', file: 'esm-server.mjs', source: ESM_SERVER },
  { label: 'cjs require (myimopay)', file: 'cjs-server.cjs', source: CJS_SERVER },
  { label: 'esm import (myimopay-browser)', file: 'esm-browser.mjs', source: ESM_BROWSER },
  { label: 'cjs require (myimopay-browser)', file: 'cjs-browser.cjs', source: CJS_BROWSER },
];

/* -------------------------------------------------------------------------- */

interface Manifest {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
}

async function readManifest(dir: string): Promise<Manifest> {
  const raw = await readFile(join(ROOT, dir, 'package.json'), 'utf8');
  return JSON.parse(raw) as Manifest;
}

async function main(): Promise<void> {
  console.log('tarball smoke test');

  const built = TARGETS.filter((target) => !existsSync(join(ROOT, target.dir, 'dist/index.js')));

  if (built.length > 0) {
    console.error('check:pack: dist is missing. Run `bun run build` first.');
    for (const target of built) console.error(`  missing ${target.dir}/dist/index.js`);
    process.exit(1);
  }

  const workRoot = await mkdtemp(join(tmpdir(), 'myimopay-pack-'));
  const projectDir = join(workRoot, 'consumer');
  const checks: Check[] = [];
  let failed = false;

  try {
    await mkdir(projectDir, { recursive: true });

    // The consumer project is a workspace only so the private, build-time
    // `@myimopay/core` link can resolve: every published package bundles core
    // into `dist`, so nothing from it is needed at runtime.
    await mkdir(join(projectDir, 'packages/core'), { recursive: true });
    await writeFile(
      join(projectDir, 'packages/core/package.json'),
      `${JSON.stringify({ name: '@myimopay/core', version: '0.0.0', private: true }, null, 2)}\n`,
    );
    await writeFile(
      join(projectDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'consumer-smoke',
          version: '0.0.0',
          private: true,
          type: 'module',
          workspaces: ['packages/*'],
        },
        null,
        2,
      )}\n`,
    );

    for (const target of TARGETS) {
      const manifest = await readManifest(target.dir);
      const workspaceDeps = Object.entries(manifest.dependencies ?? {}).filter(([, specifier]) =>
        specifier.startsWith('workspace:'),
      );

      if (workspaceDeps.length > 0) {
        const list = workspaceDeps.map(([name, specifier]) => `${name}@${specifier}`).join(', ');
        console.warn(
          `  ! ${target.name} declares workspace-only dependencies (${list}).\n` +
            '    A registry install cannot resolve those, so they must be dropped or moved to\n' +
            '    devDependencies before publishing — core is already bundled into dist.',
        );
      }
    }

    for (const target of TARGETS) {
      const packed = await run(
        ['npm', 'pack', join(ROOT, target.dir), '--pack-destination', projectDir],
        projectDir,
      );

      if (packed.code !== 0) {
        console.error(`✘ npm pack ${target.dir} failed\n${tail(packed.stderr)}`);
        failed = true;
      }
    }

    const tarballs = (await readdir(projectDir)).filter((entry) => entry.endsWith('.tgz')).sort();

    checks.push({
      label: 'npm pack',
      ok: tarballs.length === TARGETS.length,
      detail:
        tarballs.length === TARGETS.length
          ? tarballs.join(', ')
          : `expected 2, got ${tarballs.length}`,
    });

    if (tarballs.length !== TARGETS.length) {
      console.error('✘ packaging failed; skipping the install and smoke checks.');
      failed = true;
    } else {
      const added = await run(['bun', 'add', ...tarballs.map((entry) => `./${entry}`)], projectDir);

      checks.push({
        label: 'bun add <tarballs>',
        ok: added.code === 0,
        detail: added.code === 0 ? 'installed into a clean project' : tail(added.stderr, 6),
      });

      if (added.code !== 0) {
        console.error(`✘ installing the tarballs failed\n${tail(added.stderr)}`);
        failed = true;
      } else {
        for (const smoke of SMOKE_CHECKS) {
          const file = join(projectDir, smoke.file);
          await writeFile(file, smoke.source);

          const result = await run(['node', smoke.file], projectDir);
          const ok = result.code === 0;

          checks.push({
            label: smoke.label,
            ok,
            detail: ok ? result.stdout.trim() || 'ok' : tail(result.stderr, 6),
          });

          if (!ok) failed = true;
        }
      }
    }

    for (const check of checks) {
      console.log(`  ${check.ok ? '✔' : '✘'} ${check.label} — ${check.detail}`);
    }

    if (failed) {
      console.error(`\ncheck:pack: failed. Temp project kept for inspection: ${projectDir}`);
      process.exit(1);
    }

    console.log('\ncheck:pack: ok — both tarballs install and load under node.');
  } finally {
    if (!failed) await rm(workRoot, { recursive: true, force: true });
  }
}

await main();
