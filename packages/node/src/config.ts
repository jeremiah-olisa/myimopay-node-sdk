import type { Environment } from '@myimopay/core';

/**
 * Server configuration for `new MyImoPay(config)`.
 *
 * `environment` is required on purpose: there is no default that could bill a
 * live account by accident. `baseUrl` is an explicit override for proxies,
 * mock servers and self-hosted gateways only.
 */
export interface MyImoPayConfig {
  /** `staging` (still real money) or `live`. */
  environment: Environment;
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
}

/**
 * Merges overrides into a config without ever turning an omitted option into an
 * explicit `undefined` (which `exactOptionalPropertyTypes` treats differently).
 * Used by `client.with(...)`.
 */
export function mergeConfig(
  base: MyImoPayConfig,
  overrides: Partial<MyImoPayConfig>,
): MyImoPayConfig {
  const merged: MyImoPayConfig = { ...base };
  const target = merged as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) target[key] = value;
  }

  return merged;
}
