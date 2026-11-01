import type { DebugEvent } from './debug';

/** Minimal structural response contract, so core never depends on a DOM or Node lib. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Minimal structural request contract. */
export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  redirect?: 'error' | 'follow' | 'manual';
}

/** Anything that behaves like `fetch` (global fetch, undici, a test double). */
export type FetchLike = (input: string, init?: RequestInitLike) => Promise<FetchResponseLike>;

export interface RetryConfig {
  /** Total attempts, including the first. Default 3. */
  attempts?: number;
  /** Base backoff in milliseconds. Default 300. */
  baseDelayMs?: number;
  /** Backoff ceiling in milliseconds. Default 5000. */
  maxDelayMs?: number;
}

/** Transport configuration. Fully resolved; no optionality left by the time it is used. */
export interface HttpConfig {
  baseUrl: string;
  publicKey: string;
  secretKey?: string;
  /** Header carrying the public key. Default `xp-key`. */
  publicKeyHeader: string;
  /** Header carrying the secret key. Default `sp-key`. */
  secretKeyHeader: string;
  timeoutMs: number;
  retry: Required<RetryConfig>;
  headers: Record<string, string>;
  fetch: FetchLike;
  onDebug?: (event: DebugEvent) => void;
  userAgent: string;
}

/** What a single transport call can ask for. */
export type HttpAuthMode = 'public' | 'secret' | 'none';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Per-call overrides. Every resource method accepts these as its last argument,
 * so nothing is locked at construction time.
 *
 * Credentials are deliberately absent: a key never travels per call.
 */
export interface RequestOptions {
  /** Abort this call. */
  signal?: AbortSignal;
  /** Overrides the client timeout for this call only. */
  timeoutMs?: number;
  /** Extra headers for this call only. Credential headers are SDK-managed. */
  headers?: Record<string, string>;
  /**
   * Overrides the client base URL for this call only (proxy, mock server,
   * self-hosted gateway). Must be https.
   */
  baseUrl?: string;
}

export interface HttpRequestOptions {
  method: HttpMethod;
  /** Path relative to the API root, e.g. `/vi/pay/initiate`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  auth?: HttpAuthMode;
  /** Overrides the configured base URL for this call only. */
  baseUrl?: string;
  /** Overrides the configured timeout for this call only. */
  timeoutMs?: number;
  /**
   * Treat a 2xx envelope with `data: null` as an empty result instead of a
   * malformed response. Provider read routes use `null` for "nothing matched",
   * so their resources opt in and map it to `[]` / `null`.
   */
  allowEmpty?: boolean;
  /**
   * Marks a POST/PUT that is safe to retry because the provider de-duplicates
   * it (every write route in this API is keyed by a caller-supplied
   * reference/identifier). Defaults to false.
   */
  retryableWrite?: boolean;
  signal?: AbortSignal;
  /** Extra headers for this call only. */
  headers?: Record<string, string>;
}
