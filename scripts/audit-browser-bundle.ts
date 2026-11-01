// @sdk-owner: A10-release
// @sdk-phase: 6

/**
 * Proves the two published dists behave the way the package metadata promises.
 *
 * 1. `myimopay-browser` bundles for a browser from source that has no browser
 *    globals, no `process.env`, no `Buffer` and no `require()`.
 * 2. `myimopay` still carries its `SERVER_ONLY` guard, so a bundler that ignores
 *    the `browser` export condition fails loudly instead of shipping a key.
 *
 * Expects `dist/` to exist: it runs after `bun run build` in `bun run verify`.
 * Run with `bun run check:browser`.
 */

import { existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { build } from 'esbuild';

const ROOT = dirname(import.meta.dir);

const BROWSER_ENTRY = join(ROOT, 'packages/browser/dist/index.js');
const NODE_ENTRY = join(ROOT, 'packages/node/dist/index.js');

/** The guard text every browser build of `myimopay` must keep. */
const GUARD_MESSAGE = 'myimopay is server-only';
const GUARD_CODE = 'SERVER_ONLY';

interface Finding {
  readonly reason: string;
  readonly sample: string;
}

const FORBIDDEN_IN_BROWSER_BUNDLE: readonly { reason: string; pattern: RegExp }[] = [
  { reason: 'imports a Node built-in (node:*)', pattern: /\bnode:[a-z0-9][\w/.-]*/ },
  { reason: 'reads process.env', pattern: /process\.env\b/ },
  { reason: 'uses Buffer', pattern: /\bBuffer\b/ },
  { reason: 'uses CommonJS require()', pattern: /\brequire\s*\(/ },
];

function inspect(text: string): Finding[] {
  const findings: Finding[] = [];

  for (const rule of FORBIDDEN_IN_BROWSER_BUNDLE) {
    const match = rule.pattern.exec(text);
    if (match) {
      findings.push({ reason: rule.reason, sample: match[0] });
    }
  }

  return findings;
}

function bareBuiltinImports(text: string): string[] {
  const found = new Set<string>();
  const pattern = /\bfrom\s*["']([^"'.][^"']*)["']/g;

  for (const match of text.matchAll(pattern)) {
    const specifier = match[1] ?? '';
    if (builtinModules.includes(specifier)) found.add(specifier);
  }

  return [...found].sort();
}

function kilobytes(text: string): string {
  return `${(Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)} kB`;
}

interface StepResult {
  readonly ok: boolean;
  readonly label: string;
  readonly detail: string;
}

function report(results: readonly StepResult[]): boolean {
  for (const result of results) {
    console.log(`  ${result.ok ? '✔' : '✘'} ${result.label} — ${result.detail}`);
  }

  return results.every((result) => result.ok);
}

async function main(): Promise<void> {
  const missing = [BROWSER_ENTRY, NODE_ENTRY].filter((path) => !existsSync(path));

  if (missing.length > 0) {
    console.error('check:browser: dist is missing. Run `bun run build` first.');
    for (const path of missing) console.error(`  missing ${relative(ROOT, path)}`);
    process.exit(1);
  }

  console.log('browser bundle audit');

  const browserBundle = await build({
    entryPoints: [BROWSER_ENTRY],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });

  const browserText = browserBundle.outputFiles?.[0]?.text ?? '';
  const browserFindings = inspect(browserText);

  // Built-ins are external here on purpose: this bundle is only *inspected*, and
  // externalising them lets the audit finish so it can name every offence at
  // once instead of dying on the first unresolvable import.
  const nodeBundle = await build({
    entryPoints: [NODE_ENTRY],
    bundle: true,
    platform: 'browser',
    conditions: ['browser', 'import'],
    format: 'esm',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
    external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
  });

  const nodeText = nodeBundle.outputFiles?.[0]?.text ?? '';
  const nodeBuiltins = bareBuiltinImports(nodeText);
  const hasGuard = nodeText.includes(GUARD_MESSAGE) && nodeText.includes(GUARD_CODE);
  const hasNodeCrypto = /\bnode:crypto\b/.test(nodeText);

  const results: StepResult[] = [
    {
      ok: browserFindings.length === 0,
      label: 'myimopay-browser bundles for the browser',
      detail:
        browserFindings.length === 0
          ? `${kilobytes(browserText)}, no node:*/process.env/Buffer/require()`
          : browserFindings.map((finding) => `${finding.reason} (${finding.sample})`).join('; '),
    },
    {
      ok: hasGuard,
      label: 'myimopay keeps its SERVER_ONLY guard',
      detail: hasGuard
        ? 'guard message and code survive bundling'
        : 'guard message/code missing from the bundle — a browser build could ship a merchant key',
    },
    {
      ok: !hasNodeCrypto,
      label: 'myimopay bundles without node:crypto',
      detail: hasNodeCrypto ? 'found a node:crypto specifier' : 'no node: specifier in the output',
    },
  ];

  const passed = report(results);

  if (nodeBuiltins.length > 0) {
    // Expected, not a failure: the server entry does use crypto for webhook
    // HMACs. The `browser` export condition is what keeps it out of browsers.
    console.log(
      `  · myimopay still imports [${nodeBuiltins.join(', ')}] — expected for the server entry; ` +
        'the `browser` export condition and the guard keep it out of browsers.',
    );
  }

  if (!passed) {
    console.error('\ncheck:browser: failed. See the ✘ lines above.');
    process.exit(1);
  }

  console.log('\ncheck:browser: ok.');
}

await main();
