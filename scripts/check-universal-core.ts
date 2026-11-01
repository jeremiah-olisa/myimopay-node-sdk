// @sdk-owner: A10-release
// @sdk-phase: 6

/**
 * `packages/core` is bundled into the browser package, so it must stay
 * runtime-neutral: no Node built-in may ever reach it, and it must not touch a
 * global that only exists in one runtime.
 *
 * This is a lexical gate, not a compiler: it scans source text with comments and
 * string literals masked out so that prose like "24h window." cannot trip it,
 * while a real `import ... from 'node:crypto'` always does.
 *
 * Run with `bun run check:universal`.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const ROOT = dirname(import.meta.dir);
const CORE_SOURCE_GLOB = 'packages/core/src/**/*.ts';

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

/** A file split into the two views the rules need. */
interface Masks {
  /** Comments blanked; string literals kept (import specifiers live in strings). */
  readonly withoutComments: string;
  /** Comments and string literals blanked (so identifiers are always real code). */
  readonly codeOnly: string;
}

function escapeLength(source: string, start: number): number {
  // `\x` consumes the backslash plus one escaped character; `\u{...}` and `\uXXXX`
  // are covered by walking one character at a time, which is enough for masking.
  return source[start + 1] === '\r' && source[start + 2] === '\n' ? 3 : 2;
}

/**
 * Single pass over the file, emitting both masks at once.
 *
 * Doing it in one pass is what makes the scan trustworthy: the string state is
 * already known when a `//` shows up, so `'https://…'` never starts a comment.
 */
function buildMasks(source: string): Masks {
  const withoutComments = [...source];
  const codeOnly = [...source];

  const blank = (target: string[], from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      const char = target[index];
      if (char !== '\n' && char !== '\r') target[index] = ' ';
    }
  };

  const length = source.length;
  let cursor = 0;

  while (cursor < length) {
    const char = source[cursor] ?? '';
    const next = source[cursor + 1] ?? '';

    if (char === '/' && next === '/') {
      let end = cursor;
      while (end < length && source[end] !== '\n') end += 1;
      blank(withoutComments, cursor, end);
      blank(codeOnly, cursor, end);
      cursor = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', cursor + 2);
      const end = close === -1 ? length : close + 2;
      blank(withoutComments, cursor, end);
      blank(codeOnly, cursor, end);
      cursor = end;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      let index = cursor + 1;
      while (index < length) {
        const inner = source[index];
        if (inner === '\\') {
          index += escapeLength(source, index);
          continue;
        }
        if (inner === char) {
          index += 1;
          break;
        }
        index += 1;
      }
      // The literal itself is code to one view and prose to the other: only the
      // identifier scan hides it.
      blank(codeOnly, cursor, index);
      cursor = index;
      continue;
    }

    cursor += 1;
  }

  return { withoutComments: withoutComments.join(''), codeOnly: codeOnly.join('') };
}

interface Rule {
  readonly pattern: RegExp;
  readonly reason: string;
  /** Import specifiers and `require()` live in string literals, so they scan the wider view. */
  readonly includesStrings: boolean;
}

const RULES: readonly Rule[] = [
  {
    pattern: /\bnode:[a-z0-9]/g,
    reason: 'imports a Node built-in (node:*); core is bundled into the browser package',
    includesStrings: true,
  },
  {
    pattern: /\brequire\s*\(/g,
    reason: 'uses CommonJS require(); core must stay ESM and runtime-neutral',
    includesStrings: false,
  },
  {
    pattern: /\bprocess\s*[.[]/g,
    reason: 'references the Node-only global `process`',
    includesStrings: false,
  },
  {
    pattern: /\bBuffer\b/g,
    reason: 'uses the Node-only global `Buffer`; use Uint8Array',
    includesStrings: false,
  },
  {
    pattern: /\bwindow\s*[.[]/g,
    reason: 'references the browser global `window`; inject a WindowLike instead',
    includesStrings: false,
  },
  {
    pattern: /\bdocument\s*[.[]/g,
    reason: 'references the browser global `document`; inject the slice you need',
    includesStrings: false,
  },
];

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') line += 1;
  }
  return line;
}

function scanFile(absolutePath: string, source: string): Violation[] {
  const file = relative(ROOT, absolutePath);
  const masks = buildMasks(source);
  const violations: Violation[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    const haystack = rule.includesStrings ? masks.withoutComments : masks.codeOnly;

    for (const match of haystack.matchAll(rule.pattern)) {
      const offset = match.index;
      const key = `${offset}:${rule.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({ file, line: lineNumberAt(haystack, offset), reason: rule.reason });
    }
  }

  return violations.sort((left, right) => left.line - right.line);
}

async function main(): Promise<void> {
  const glob = new Bun.Glob(CORE_SOURCE_GLOB);
  const files: string[] = [];

  for await (const entry of glob.scan({ cwd: ROOT, onlyFiles: true })) {
    files.push(entry);
  }

  files.sort();

  if (files.length === 0) {
    console.error(`universal-core: no files matched ${CORE_SOURCE_GLOB} under ${ROOT}`);
    process.exit(1);
  }

  const violations: Violation[] = [];

  for (const file of files) {
    const absolutePath = join(ROOT, file);
    const source = await readFile(absolutePath, 'utf8');
    violations.push(...scanFile(absolutePath, source));
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}:${violation.line}: ${violation.reason}`);
    }
    console.error(`\nuniversal-core: ${violations.length} violation(s) in ${files.length} files.`);
    console.error(
      'packages/core is bundled into myimopay-browser — move runtime-specific code elsewhere.',
    );
    process.exit(1);
  }

  console.log(
    `universal-core: ${files.length} files scanned, 0 violations — core stays runtime-neutral.`,
  );
}

await main();
