// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import type { Environment, HttpConfig } from '@myimopay/core';
import { createReference, HttpClient, MyImoPayError } from '@myimopay/core';
import type { MyImoPayConfig, ResolvedConfig } from './config';
import { mergeConfig, resolveConfig } from './config';
import type { ResourceContext } from './context';
import type { EnvLike } from './env';
import { configFromEnv } from './env';
import { BanksResource } from './resources/banks';
import { PaymentsResource } from './resources/payments';
import { SettlementOrdersResource } from './resources/settlement-orders';
import { SettlementsResource } from './resources/settlements';
import { SubaccountsResource } from './resources/subaccounts';
import { TransactionsResource } from './resources/transactions';
import type { WebhookEvent, WebhookOptions } from './webhooks';
import { constructEvent, signWebhookPayload, verifyWebhookSignature } from './webhooks';

export { DEFAULT_BASE_URLS } from './config';

const BROWSER_GUARD_MESSAGE =
  'myimopay is server-only: it holds your merchant secret key, and a browser bundle is not a safe place for it. Install myimopay-browser for frontend checkout helpers — it is keyless by design and cannot leak your key.';

/**
 * Refuses to build a client where a browser global is visible.
 *
 * The check reads through the global object instead of naming `window`, so it
 * compiles and lints under Node without a DOM and cannot throw a
 * `ReferenceError` in a runtime that has no window at all.
 */
function assertServerRuntime(): void {
  const scope: { window?: unknown } = globalThis;

  if (scope.window !== undefined) {
    throw new MyImoPayError({ code: 'SERVER_ONLY', message: BROWSER_GUARD_MESSAGE });
  }
}

/** Projects the validated config onto the transport contract. */
function toHttpConfig(resolved: ResolvedConfig): HttpConfig {
  const httpConfig: HttpConfig = {
    baseUrl: resolved.baseUrl,
    publicKey: resolved.publicKey,
    publicKeyHeader: resolved.publicKeyHeader,
    secretKeyHeader: resolved.secretKeyHeader,
    timeoutMs: resolved.timeoutMs,
    retry: resolved.retry,
    headers: resolved.headers,
    fetch: resolved.fetch,
    userAgent: resolved.userAgent,
  };

  // Optional keys are assigned conditionally so `exactOptionalPropertyTypes`
  // never has to treat an explicit `undefined` as a value.
  if (resolved.secretKey !== undefined) httpConfig.secretKey = resolved.secretKey;
  if (resolved.onDebug !== undefined) httpConfig.onDebug = resolved.onDebug;

  return httpConfig;
}

/**
 * The server client.
 *
 * One instance owns one transport and hands it to every resource, so timeout,
 * retry and auth behaviour cannot drift between namespaces.
 */
export class MyImoPay {
  readonly payments: PaymentsResource;
  readonly transactions: TransactionsResource;
  readonly settlements: SettlementsResource;
  readonly banks: BanksResource;
  readonly subaccounts: SubaccountsResource;
  readonly settlementOrders: SettlementOrdersResource;

  /** The caller config as given, kept so `with()` can derive from it. */
  readonly #config: MyImoPayConfig;
  readonly #resolved: ResolvedConfig;

  constructor(config: MyImoPayConfig) {
    assertServerRuntime();

    const resolved = resolveConfig(config);

    this.#config = { ...config };
    this.#resolved = resolved;

    const http = new HttpClient(toHttpConfig(resolved));
    const context: ResourceContext = { http, maxAmount: resolved.maxAmount };

    this.payments = new PaymentsResource(context);
    this.transactions = new TransactionsResource(context);
    this.settlements = new SettlementsResource(context);
    this.banks = new BanksResource(context);
    this.subaccounts = new SubaccountsResource(context);
    this.settlementOrders = new SettlementOrdersResource(context);
  }

  /** Builds a reference that always fits the provider's 20-character limit. */
  reference(seed?: string): string {
    return createReference(seed);
  }

  /** `staging` or `live`; never a secret. */
  get environment(): Environment {
    return this.#resolved.environment;
  }

  /** The resolved base URL currently in effect. */
  get baseUrl(): string {
    return this.#resolved.baseUrl;
  }

  /**
   * Derives a new client with any option overridden — base URL, keys, timeout,
   * retry policy, headers, guardrails. The original client is untouched.
   */
  with(overrides: Partial<MyImoPayConfig>): MyImoPay {
    return new MyImoPay(mergeConfig(this.#config, overrides));
  }

  /** Reads `MYIMOPAY_*` variables through a caller-supplied env object. */
  static fromEnv(env?: EnvLike): MyImoPay {
    return new MyImoPay(configFromEnv(env));
  }

  /** Webhook helpers, also exported top-level for handlers that need no client. */
  static readonly webhooks: {
    constructEvent: typeof constructEvent;
    verifyWebhookSignature: typeof verifyWebhookSignature;
    signWebhookPayload: typeof signWebhookPayload;
  } = {
    constructEvent,
    verifyWebhookSignature,
    signWebhookPayload,
  };
}

/** Functional alias for `new MyImoPay(config)`. */
export function createClient(config: MyImoPayConfig): MyImoPay {
  return new MyImoPay(config);
}

export type { WebhookEvent, WebhookOptions };
