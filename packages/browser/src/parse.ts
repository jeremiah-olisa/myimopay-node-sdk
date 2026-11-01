// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: A8-browser

/** Reference keys, in the order the provider has used them. */
const REFERENCE_KEYS = ['tx_ref', 'tx_reference', 'reference', 'ref'] as const;

/** Status keys, in the same spirit. */
const STATUS_KEYS = ['status', 'payment_status', 'transaction_status'] as const;

/**
 * What a checkout return page actually tells you.
 *
 * A query string is attacker-controlled: anyone can navigate to
 * `/thank-you?status=success`. This is a hint to decide what to render, never
 * evidence that money moved — the server must call `payments.verify` first.
 */
export interface CheckoutHint {
  reference: string | null;
  /** The provider's raw status word from the query string, if any. */
  statusHint: string | null;
  /** True only when `expectedReference` was supplied and equals `reference`. */
  referenceMatches: boolean;
  /** Everything the provider put in the query string, untouched. */
  rawQuery: Record<string, string>;
  /** Always false in v1: a checkout return is a hint, never proof of payment. */
  verified: false;
}

/**
 * Reads a checkout return query string.
 *
 * Accepts a bare `?a=b` or a full URL. Never throws: unknown keys are kept in
 * `rawQuery`, and a missing reference is a legitimate `null`.
 */
export function parseCheckoutResult(
  search: string,
  options?: { expectedReference?: string },
): CheckoutHint {
  const params = new URLSearchParams(toQueryString(search));
  const rawQuery = firstValues(params);
  const reference = pickFirst(rawQuery, REFERENCE_KEYS);
  const expectedReference = options?.expectedReference;

  return {
    reference,
    statusHint: pickFirst(rawQuery, STATUS_KEYS),
    referenceMatches:
      expectedReference !== undefined && reference !== null && reference === expectedReference,
    rawQuery,
    verified: false,
  };
}

/** Keeps the first value per key; `URLSearchParams` already percent-decodes. */
function firstValues(params: URLSearchParams): Record<string, string> {
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const [key, value] of params) {
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push([key, value]);
  }

  // `fromEntries` defines own properties, so a `__proto__` key stays data.
  return Object.fromEntries(entries);
}

/** First key that carries a non-blank value. */
function pickFirst(query: Record<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = query[key];
    if (value === undefined) continue;

    const trimmed = value.trim();
    if (trimmed !== '') return trimmed;
  }
  return null;
}

/** Reduces `''`, `'?a=1'`, `'a=1'` and a full URL to their query portion. */
function toQueryString(search: string): string {
  if (typeof search !== 'string') return '';

  const value = search.trim();
  if (value === '') return '';

  const fromUrl = queryOfAbsoluteUrl(value);
  if (fromUrl !== null) return fromUrl;

  const withoutFragment = stripFragment(value);
  const queryStart = withoutFragment.indexOf('?');
  if (queryStart === -1) return looksLikePath(withoutFragment) ? '' : withoutFragment;

  return withoutFragment.slice(queryStart + 1);
}

/** `null` when `value` is not an absolute URL, so the caller falls back. */
function queryOfAbsoluteUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.search.startsWith('?') ? url.search.slice(1) : url.search;
  } catch {
    return null;
  }
}

function stripFragment(value: string): string {
  const hash = value.indexOf('#');
  return hash === -1 ? value : value.slice(0, hash);
}

/** A relative path carries no query of its own; only its `?...` part does. */
function looksLikePath(value: string): boolean {
  return value.startsWith('/') || value.includes('://');
}
