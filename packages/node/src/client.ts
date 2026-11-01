// @sdk-owner: A0-contracts
// @sdk-phase: 1

import type { Environment, HttpConfig } from '@myimopay/core';
import { createReference, HttpClient } from '@myimopay/core';
import type { MyImoPayConfig } from './config';
import { mergeConfig } from './config';
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

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 5_000;
const DEFAULT_PUBLIC_KEY_HEADER = 'xp-key';
const DEFAULT_SECRET_KEY_HEADER = 'sp-key';
const USER_AGENT = 'myimopay-node/0.1.0';

/**
 * Fully resolves a caller config into the transport contract.
 *
 * Core's `HttpConfig` has no optionality left by the time a request is built,
 * so every default lives here and nowhere else.
 */
function resolveHttpConfig(config: MyImoPayConfig): HttpConfig {
  const retry = config.retry;
  const httpConfig: HttpConfig = {
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URLS[config.environment],
    publicKey: config.publicKey,
    publicKeyHeader: config.publicKeyHeader ?? DEFAULT_PUBLIC_KEY_HEADER,
    secretKeyHeader: config.secretKeyHeader ?? DEFAULT_SECRET_KEY_HEADER,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retry: {
      attempts: retry?.attempts ?? DEFAULT_ATTEMPTS,
      baseDelayMs: retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      maxDelayMs: retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    },
    headers: { ...config.headers },
    fetch: config.fetch ?? globalThis.fetch,
    userAgent: USER_AGENT,
  };

  // Optional keys are assigned conditionally so `exactOptionalPropertyTypes`
  // never has to treat an explicit `undefined` as a value.
  if (config.secretKey !== undefined) httpConfig.secretKey = config.secretKey;
  if (config.onDebug !== undefined) httpConfig.onDebug = config.onDebug;

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

  readonly #config: MyImoPayConfig;

  constructor(config: MyImoPayConfig) {
    this.#config = config;
    const http = new HttpClient(resolveHttpConfig(config));
    const context: ResourceContext = { http, maxAmount: config.maxAmount };

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
    return this.#config.environment;
  }

  /** The resolved base URL currently in effect. */
  get baseUrl(): string {
    return this.#config.baseUrl ?? DEFAULT_BASE_URLS[this.#config.environment];
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
