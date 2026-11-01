// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import type { DebugEvent, Environment, FetchLike, RetryConfig } from '@myimopay/core';
import { assertHttpsUrl, isMyImoPayError, MyImoPayError } from '@myimopay/core';

/**
 * Server configuration for `new MyImoPay(config)`.
 *
 * `environment` is required on purpose: there is no default that could bill a
 * live account by accident. `baseUrl` is an explicit override for proxies,
 * mock servers and self-hosted gateways only.
 */
export interface MyImoPayConfig {
  /**
   * `staging` (still real money) or `live`.
   *
   * Optional **only** when an explicit `baseUrl` is supplied. There is no
   * implicit default: guessing the environment is how a staging build ends up
   * billing a live account.
   */
  environment?: Environment;
  /**
   * Remaps the host for one or both environments without changing what
   * `environment` means. Useful for a tunnel, a proxy or a provider staging
   * host change. `baseUrl` still wins over this.
   */
  environments?: Partial<Record<Environment, string>>;
  /** Merchant public key, sent as `xp-key`. Never put this in a browser bundle. */
  publicKey: string;
  /** Merchant secret key, sent as `sp-key`. Needed for subaccounts and split orders. */
  secretKey?: string;
  /** Overrides the environment's base URL. Must be https. */
  baseUrl?: string;
  /** Per-request timeout. Default 20000ms. */
  timeoutMs?: number;
  retry?: {
    /** Total attempts including the first. Default 3. */
    attempts?: number;
    /** Base backoff in ms. Default 300. */
    baseDelayMs?: number;
    /** Backoff ceiling in ms. Default 5000. */
    maxDelayMs?: number;
  };
  /** Extra headers on every request. Credential headers are managed by the SDK. */
  headers?: Record<string, string>;
  /** Header carrying the public key. Default `xp-key`. */
  publicKeyHeader?: string;
  /** Header carrying the secret key. Default `sp-key`. */
  secretKeyHeader?: string;
  /** Injectable fetch for tests, proxies and instrumented runtimes. */
  fetch?: import('@myimopay/core').FetchLike;
  /** Structured, already-redacted diagnostics. Never receives credentials. */
  onDebug?: (event: import('@myimopay/core').DebugEvent) => void;
  /** Refuses any initiation above this amount. Recommended in staging. */
  maxAmount?: number;
  /**
   * Customer-field policy. Defaults match what the provider accepts in
   * practice (see docs/provider-notes.md); every switch is opt-out so a caller
   * that already normalises its own data is never second-guessed.
   */
  customer?: {
    /**
     * Strip punctuation, merge one-letter words and pad single-word names.
     * Default true. Disable to send `customer.fullName` verbatim.
     */
    sanitizeName?: boolean;
    /**
     * The provider rejects initiations without a customer email in practice,
     * even though its schema marks the field optional. Default true: a missing
     * email fails locally with an actionable error instead of a provider 400
     * after the payer has been redirected. Disable only if you have verified
     * the provider accepts your flow without one.
     */
    requireEmail?: boolean;
    /**
     * When set, a missing email is derived as `<phone>@domain` (for USSD/POS
     * flows where the payer has no email). Off by default: fabricating an
     * address is a product decision.
     */
    emailFallbackDomain?: string;
  };
}

/**
 * Default provider hosts, keyed by environment.
 *
 * Both are overridable at any time: `config.baseUrl` overrides the environment
 * for the whole client, `client.with({ baseUrl })` derives a client that points
 * elsewhere, and every resource method accepts `{ baseUrl }` for a single call.
 */
export const DEFAULT_BASE_URLS: Readonly<Record<Environment, string>> = {
  staging: 'https://apipg.demo.myimopay.com',
  live: 'https://api.myimopay.com',
};

/**
 * A caller config with every default applied and every value validated.
 *
 * This is the only shape the client and the transport are allowed to read, so
 * "what did the caller actually get" is answerable in one place.
 */
export interface ResolvedConfig {
  readonly environment: Environment | null;
  readonly baseUrl: string;
  readonly publicKey: string;
  readonly secretKey: string | undefined;
  readonly publicKeyHeader: string;
  readonly secretKeyHeader: string;
  readonly timeoutMs: number;
  readonly retry: Required<RetryConfig>;
  readonly headers: Record<string, string>;
  readonly maxAmount: number | undefined;
  readonly customer: ResolvedCustomerPolicy;
  readonly fetch: FetchLike;
  readonly onDebug: ((event: DebugEvent) => void) | undefined;
  readonly userAgent: string;
}

/** Fully resolved customer policy; no optionality left. */
export interface ResolvedCustomerPolicy {
  readonly sanitizeName: boolean;
  readonly requireEmail: boolean;
  readonly emailFallbackDomain: string | undefined;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_ATTEMPTS = 10;
const DEFAULT_BASE_DELAY_MS = 300;
const MIN_BASE_DELAY_MS = 1;
const MAX_BASE_DELAY_MS = 10_000;
const DEFAULT_MAX_DELAY_MS = 5_000;
const DEFAULT_PUBLIC_KEY_HEADER = 'xp-key';
const DEFAULT_SECRET_KEY_HEADER = 'sp-key';
const SDK_VERSION = typeof __MYIMOPAY_VERSION__ === 'string' ? __MYIMOPAY_VERSION__ : '0.0.0';
const USER_AGENT = `myimopay-node/${SDK_VERSION}`;
const MIN_PUBLIC_KEY_LENGTH = 8;
const MAX_AMOUNT_CEILING = 1_000_000_000;
const HEADER_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Headers the SDK owns. Accepting them from a caller would let one override
 * transport behaviour (framing, auth) and silently change what the signature
 * covers, so they are rejected rather than merged.
 */
const RESERVED_HEADER_NAMES: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'content-type',
  'authorization',
]);

function invalidConfig(message: string): never {
  throw new MyImoPayError({ code: 'INVALID_CONFIG', message });
}

/** Renders a rejected value without ever echoing key material. */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return typeof value;
}

function readEnvironment(value: unknown): Environment | null {
  if (value === undefined) return null;
  if (value === 'staging' || value === 'live') return value;
  invalidConfig(
    `environment must be 'staging' or 'live' when provided (received ${formatValue(
      value,
    )}). There is no default: guessing it is how a staging build ends up billing a live account.`,
  );
}

/**
 * Validates a per-environment host override map.
 *
 * Unknown keys are rejected rather than ignored: `{ statging: '...' }` silently
 * doing nothing is exactly the kind of typo that reaches production.
 */
function readEnvironments(value: unknown): Partial<Record<Environment, string>> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidConfig('environments must be an object such as { staging: "https://..." }.');
  }

  const source = value as Record<string, unknown>;
  const resolved: Partial<Record<Environment, string>> = {};

  for (const key of Object.keys(source)) {
    if (key !== 'staging' && key !== 'live') {
      invalidConfig(`environments.${key} is not a known environment. Use "staging" or "live".`);
    }

    const raw = source[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || raw.trim() === '') {
      invalidConfig(`environments.${key} must be a non-empty https URL.`);
    }

    try {
      assertHttpsUrl(raw, `environments.${key}`);
      // Keep the caller's spelling; the transport joins paths without doubling
      // slashes, and `client.baseUrl` should report what was configured.
      resolved[key] = raw.trim();
    } catch (error) {
      if (!isMyImoPayError(error) || error.code !== 'VALIDATION_ERROR') throw error;
      invalidConfig(`environments.${key} must be an absolute https URL without credentials.`);
    }
  }

  return resolved;
}

function readPublicKey(value: unknown): string {
  if (typeof value !== 'string') {
    invalidConfig(
      'publicKey must be a string. Use the merchant public key from the MyIMO Pay dashboard.',
    );
  }

  const key = value.trim();

  if (key.length === 0) {
    invalidConfig(
      'publicKey must not be empty. Use the merchant public key from the MyIMO Pay dashboard.',
    );
  }

  if (key.length < MIN_PUBLIC_KEY_LENGTH) {
    invalidConfig(
      `publicKey must be at least ${MIN_PUBLIC_KEY_LENGTH} characters after trimming (received ${key.length}). Check that you pasted the whole key.`,
    );
  }

  return key;
}

function readSecretKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== 'string') {
    invalidConfig('secretKey must be a string when provided.');
  }

  const key = value.trim();

  if (key.length === 0) {
    invalidConfig(
      'secretKey must not be empty when provided. Omit it for public-key-only calls, or supply the merchant secret key.',
    );
  }

  return key;
}

/**
 * Validates a base URL with core's parser, then surfaces the failure as
 * `INVALID_CONFIG` with a message about the config field rather than the
 * helper's field-level wording.
 *
 * The caller's spelling is preserved (no `URL#href` re-serialisation) so
 * `client.baseUrl` reports exactly what was configured.
 */
function readBaseUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;

  const baseUrl = typeof value === 'string' ? value.trim() : '';

  try {
    assertHttpsUrl(baseUrl, 'baseUrl');
  } catch (error) {
    // Only a rejected URL becomes INVALID_CONFIG; anything else is a real bug
    // in the helper and must not be disguised as a caller mistake.
    if (!isMyImoPayError(error) || error.code !== 'VALIDATION_ERROR') throw error;

    invalidConfig(
      'baseUrl must be an absolute https URL without embedded credentials, such as "https://api.myimopay.com". Plain http would send merchant credentials in clear text.',
    );
  }

  return baseUrl;
}

function readTimeoutMs(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_TIMEOUT_MS
  ) {
    invalidConfig(
      `timeoutMs must be a number greater than 0 and at most ${MAX_TIMEOUT_MS} (received ${formatValue(
        value,
      )}).`,
    );
  }

  return value;
}

function readAttempts(value: unknown): number {
  if (value === undefined) return DEFAULT_ATTEMPTS;

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_ATTEMPTS) {
    invalidConfig(
      `retry.attempts must be an integer between 1 and ${MAX_ATTEMPTS} (received ${formatValue(
        value,
      )}).`,
    );
  }

  return value;
}

function readBaseDelayMs(value: unknown): number {
  if (value === undefined) return DEFAULT_BASE_DELAY_MS;

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_BASE_DELAY_MS ||
    value > MAX_BASE_DELAY_MS
  ) {
    invalidConfig(
      `retry.baseDelayMs must be an integer between ${MIN_BASE_DELAY_MS} and ${MAX_BASE_DELAY_MS} (received ${formatValue(
        value,
      )}).`,
    );
  }

  return value;
}

function readMaxDelayMs(value: unknown, baseDelayMs: number): number {
  if (value === undefined) return Math.max(DEFAULT_MAX_DELAY_MS, baseDelayMs);

  if (typeof value !== 'number' || !Number.isFinite(value) || value < baseDelayMs) {
    invalidConfig(
      `retry.maxDelayMs must be a number greater than or equal to retry.baseDelayMs (${baseDelayMs}); received ${formatValue(
        value,
      )}.`,
    );
  }

  return value;
}

function readRetry(value: unknown): Required<RetryConfig> {
  const source: { attempts?: unknown; baseDelayMs?: unknown; maxDelayMs?: unknown } =
    typeof value === 'object' && value !== null ? value : {};

  const baseDelayMs = readBaseDelayMs(source.baseDelayMs);

  return {
    attempts: readAttempts(source.attempts),
    baseDelayMs,
    maxDelayMs: readMaxDelayMs(source.maxDelayMs, baseDelayMs),
  };
}

function readHeaderName(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    invalidConfig(`${field} must be a non-empty header name.`);
  }

  const name = value.trim();

  if (name !== name.toLowerCase()) {
    invalidConfig(
      `${field} must be lowercase (received ${formatValue(
        name,
      )}). Header names are case-insensitive on the wire, so the SDK normalises them to avoid two spellings of the same header.`,
    );
  }

  if (!HEADER_NAME_PATTERN.test(name)) {
    invalidConfig(
      `${field} must match ${HEADER_NAME_PATTERN.source} (lowercase letters, digits and hyphens only); received ${formatValue(
        name,
      )}.`,
    );
  }

  if (RESERVED_HEADER_NAMES.has(name)) {
    invalidConfig(
      `${field} cannot be "${name}": host, content-length, content-type and authorization are managed by the SDK. Use publicKeyHeader/secretKeyHeader for credentials and \`headers\` for anything else.`,
    );
  }

  return name;
}

function readHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {};

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidConfig('headers must be a plain object mapping header names to string values.');
  }

  const headers: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = readHeaderName(rawName, `headers[${formatValue(rawName)}]`);

    if (typeof rawValue !== 'string') {
      invalidConfig(`headers[${formatValue(rawName)}] must be a string.`);
    }

    if (/[\r\n]/.test(rawValue)) {
      invalidConfig(`headers[${formatValue(rawName)}] must not contain line breaks.`);
    }

    headers[name] = rawValue;
  }

  return headers;
}

function readMaxAmount(value: unknown): number | undefined {
  if (value === undefined) return undefined;

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_AMOUNT_CEILING
  ) {
    invalidConfig(
      `maxAmount must be greater than 0 and at most ${MAX_AMOUNT_CEILING} in major units (received ${formatValue(
        value,
      )}).`,
    );
  }

  return value;
}

function readFetch(value: unknown): FetchLike {
  if (value !== undefined) {
    if (typeof value !== 'function') {
      invalidConfig('fetch must be a function with the FetchLike signature.');
    }

    return value as FetchLike;
  }

  const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;

  if (typeof globalFetch !== 'function') {
    invalidConfig(
      "No global fetch found. Run this SDK on Node 20+, or pass `fetch` in the config (for example `undici`'s).",
    );
  }

  return globalFetch;
}

function readOnDebug(value: unknown): ((event: DebugEvent) => void) | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== 'function') {
    invalidConfig('onDebug must be a function that receives DebugEvent objects.');
  }

  return value as (event: DebugEvent) => void;
}

/**
 * Validates a caller config and applies every default.
 *
 * Fails fast with `INVALID_CONFIG` rather than deferring a bad host, a
 * non-numeric timeout or a reserved header to the first network call, where the
 * failure would be a 500 in a payment path. Error messages name the field and
 * the rule, never the credential.
 */
function readCustomerPolicy(policy: MyImoPayConfig['customer']): ResolvedCustomerPolicy {
  if (policy === undefined) {
    return { sanitizeName: true, requireEmail: true, emailFallbackDomain: undefined };
  }

  if (typeof policy !== 'object' || policy === null) {
    invalidConfig('customer must be an object when provided.');
  }

  const sanitizeName = policy.sanitizeName ?? true;
  const requireEmail = policy.requireEmail ?? true;
  if (typeof sanitizeName !== 'boolean') invalidConfig('customer.sanitizeName must be a boolean.');
  if (typeof requireEmail !== 'boolean') invalidConfig('customer.requireEmail must be a boolean.');

  let emailFallbackDomain: string | undefined;
  if (policy.emailFallbackDomain !== undefined) {
    if (typeof policy.emailFallbackDomain !== 'string') {
      invalidConfig('customer.emailFallbackDomain must be a string.');
    }
    const domain = policy.emailFallbackDomain.trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      invalidConfig('customer.emailFallbackDomain must be a bare domain such as example.com.');
    }
    emailFallbackDomain = domain;
  }

  if (emailFallbackDomain === undefined && !requireEmail) {
    // Valid: the caller has confirmed its flow needs no email.
    return { sanitizeName, requireEmail, emailFallbackDomain: undefined };
  }

  return { sanitizeName, requireEmail, emailFallbackDomain };
}

export function resolveConfig(config: MyImoPayConfig): ResolvedConfig {
  if (typeof config !== 'object' || config === null) {
    invalidConfig('MyImoPay config must be an object with at least `environment` and `publicKey`.');
  }

  const environment = readEnvironment(config.environment);
  const environments = readEnvironments(config.environments);
  const publicKey = readPublicKey(config.publicKey);
  const secretKey = readSecretKey(config.secretKey);

  const explicitBaseUrl = readBaseUrl(config.baseUrl);
  const baseUrl =
    explicitBaseUrl ??
    (environment === null
      ? undefined
      : (environments[environment] ?? DEFAULT_BASE_URLS[environment]));

  if (baseUrl === undefined) {
    invalidConfig(
      "Provide `environment` ('staging' or 'live') or an explicit `baseUrl`. There is no default host, because guessing it is how a test charges a real card.",
    );
  }

  const publicKeyHeader =
    config.publicKeyHeader === undefined
      ? DEFAULT_PUBLIC_KEY_HEADER
      : readHeaderName(config.publicKeyHeader, 'publicKeyHeader');
  const secretKeyHeader =
    config.secretKeyHeader === undefined
      ? DEFAULT_SECRET_KEY_HEADER
      : readHeaderName(config.secretKeyHeader, 'secretKeyHeader');

  return {
    environment,
    baseUrl,
    publicKey,
    secretKey,
    publicKeyHeader,
    secretKeyHeader,
    timeoutMs: readTimeoutMs(config.timeoutMs),
    retry: readRetry(config.retry),
    headers: readHeaders(config.headers),
    maxAmount: readMaxAmount(config.maxAmount),
    customer: readCustomerPolicy(config.customer),
    fetch: readFetch(config.fetch),
    onDebug: readOnDebug(config.onDebug),
    userAgent: USER_AGENT,
  };
}

/**
 * Merges overrides into a config without ever turning an omitted option into an
 * explicit `undefined` (which `exactOptionalPropertyTypes` treats differently).
 * Used by `client.with(...)`.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeConfig(
  base: MyImoPayConfig,
  overrides: Partial<MyImoPayConfig>,
): MyImoPayConfig {
  const merged: MyImoPayConfig = { ...base };
  const target = merged as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;

    // Grouped options merge field-by-field, so `with({ retry: { attempts: 1 } })`
    // keeps the caller's base delay instead of resetting the whole policy.
    if ((key === 'retry' || key === 'customer') && isPlainObject(value)) {
      const current = target[key];
      target[key] = isPlainObject(current) ? { ...current, ...value } : value;
      continue;
    }

    target[key] = value;
  }

  return merged;
}
