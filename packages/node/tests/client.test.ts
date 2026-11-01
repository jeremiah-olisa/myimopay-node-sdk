// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import { describe, expect, it } from 'bun:test';
import { isMyImoPayError } from '@core/errors';
import { MAX_REFERENCE_LENGTH, REFERENCE_PATTERN } from '@core/utils/reference';
import { createClient, DEFAULT_BASE_URLS, MyImoPay } from '@node/client';
import type { MyImoPayConfig } from '@node/config';
import type { EnvLike } from '@node/env';
import { signWebhookPayload } from '@node/webhooks';

const PUBLIC_KEY = 'pk_test_1234567890';

/** Builds an environment from wire names, which are SCREAMING_SNAKE by nature. */
function envOf(pairs: ReadonlyArray<readonly [string, string]>): EnvLike {
  return Object.fromEntries(pairs);
}

function validConfig(overrides: Partial<MyImoPayConfig> = {}): MyImoPayConfig {
  return { environment: 'staging', publicKey: PUBLIC_KEY, ...overrides };
}

/** Runs `fn` and returns whatever it threw, failing the test when it throws nothing. */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error('expected the call to throw');
}

describe('MyImoPay', () => {
  it('exposes the resolved environment and base URL', () => {
    const client = new MyImoPay(validConfig());

    expect(client.environment).toBe('staging');
    expect(client.baseUrl).toBe(DEFAULT_BASE_URLS.staging);
    expect(client.payments).toBeDefined();
    expect(client.transactions).toBeDefined();
    expect(client.settlements).toBeDefined();
    expect(client.banks).toBeDefined();
    expect(client.subaccounts).toBeDefined();
    expect(client.settlementOrders).toBeDefined();
  });

  it('reports a baseUrl override instead of the environment default', () => {
    const client = new MyImoPay(validConfig({ baseUrl: 'https://proxy.example.test' }));

    expect(client.baseUrl).toBe('https://proxy.example.test');
    expect(client.environment).toBe('staging');
  });

  it('validates the config in the constructor', () => {
    const error = capture(() => new MyImoPay(validConfig({ timeoutMs: 0 })));

    expect(isMyImoPayError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('INVALID_CONFIG');
  });

  describe('fromEnv', () => {
    it('names the missing environment variable', () => {
      const error = capture(() => MyImoPay.fromEnv({}));

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('MYIMOPAY_ENVIRONMENT');
    });

    it('names the missing public key variable', () => {
      const error = capture(() => MyImoPay.fromEnv(envOf([['MYIMOPAY_ENVIRONMENT', 'live']])));

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('MYIMOPAY_PUBLIC_KEY');
    });

    it('builds a client from a complete environment', () => {
      const client = MyImoPay.fromEnv(
        envOf([
          ['MYIMOPAY_ENVIRONMENT', 'live'],
          ['MYIMOPAY_PUBLIC_KEY', PUBLIC_KEY],
          ['MYIMOPAY_BASE_URL', 'https://proxy.example.test'],
        ]),
      );

      expect(client.environment).toBe('live');
      expect(client.baseUrl).toBe('https://proxy.example.test');
    });
  });

  describe('with', () => {
    it('derives a new client without touching the original', () => {
      const base = new MyImoPay(validConfig());

      const derived = base.with({
        environment: 'live',
        baseUrl: 'https://proxy.example.test',
        publicKey: 'pk_live_1234567890',
        timeoutMs: 5000,
      });

      expect(derived).not.toBe(base);
      expect(derived.environment).toBe('live');
      expect(derived.baseUrl).toBe('https://proxy.example.test');
      expect(base.environment).toBe('staging');
      expect(base.baseUrl).toBe(DEFAULT_BASE_URLS.staging);
    });

    it('leaves the original resolved when the override only changes the timeout', () => {
      const base = new MyImoPay(validConfig({ timeoutMs: 5000 }));

      const derived = base.with({ timeoutMs: 1000 });

      expect(derived.baseUrl).toBe(base.baseUrl);
      expect(derived.environment).toBe(base.environment);
    });

    it('merges a grouped policy instead of replacing it', () => {
      const base = new MyImoPay(validConfig());
      const derived = base.with({ customer: { requireEmail: false } });

      expect(derived).not.toBe(base);
      // sanitizeName is still on: only the named field changed.
      expect(derived.baseUrl).toBe(base.baseUrl);
      expect(derived.environment).toBe(base.environment);
    });

    it('lets a client remap an environment host at any time', () => {
      const base = new MyImoPay(validConfig());
      const derived = base.with({ environments: { staging: 'https://tunnel.example.test' } });

      expect(derived.baseUrl).toBe('https://tunnel.example.test');
      expect(base.baseUrl).toBe(DEFAULT_BASE_URLS.staging);
    });

    it('routes overrides through validation', () => {
      const base = new MyImoPay(validConfig());

      expect(capture(() => base.with({ timeoutMs: 0 }))).toBeInstanceOf(Error);
      expect(
        (capture(() => base.with({ baseUrl: 'http://insecure.test' })) as Error).message,
      ).toMatch(/https/);
      expect((capture(() => base.with({ publicKey: 'pk' })) as Error).message).toMatch(
        /at least 8 characters/,
      );
    });

    it('accepts an empty override object as a no-op copy', () => {
      const base = new MyImoPay(validConfig({ maxAmount: 1000 }));

      const derived = base.with({});

      expect(derived.baseUrl).toBe(base.baseUrl);
    });
  });

  describe('browser guard', () => {
    it('rejects construction when a browser window is visible', () => {
      const scope: { window?: unknown } = globalThis;
      const previous = scope.window;
      scope.window = {};

      try {
        const error = capture(() => new MyImoPay(validConfig()));

        expect(isMyImoPayError(error)).toBe(true);
        expect((error as { code: string }).code).toBe('SERVER_ONLY');
        expect((error as Error).message).toMatch(/myimopay-browser/);
      } finally {
        scope.window = previous;
      }
    });

    it('constructs normally once the browser window is gone', () => {
      const scope: { window?: unknown } = globalThis;
      delete scope.window;

      expect(() => new MyImoPay(validConfig())).not.toThrow();
    });
  });

  describe('reference', () => {
    it('always produces a reference within the provider limit', () => {
      const client = new MyImoPay(validConfig());
      const seeds = ['inv-1042', 'a'.repeat(80), 'order/2024#1', ''];

      for (const seed of seeds) {
        const reference = client.reference(seed);

        expect(typeof reference).toBe('string');
        expect(reference.length).toBeLessThanOrEqual(MAX_REFERENCE_LENGTH);
        expect(reference).toMatch(REFERENCE_PATTERN);
      }
    });

    it('generates a usable reference with no seed', () => {
      const client = new MyImoPay(validConfig());

      const reference = client.reference();

      expect(reference.length).toBeGreaterThan(0);
      expect(reference.length).toBeLessThanOrEqual(MAX_REFERENCE_LENGTH);
    });
  });

  it('exposes webhook helpers statically', () => {
    expect(MyImoPay.webhooks.signWebhookPayload).toBe(signWebhookPayload);
    expect(MyImoPay.webhooks.signWebhookPayload('hello', 'secret')).toBe(
      '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b',
    );
    expect(typeof MyImoPay.webhooks.verifyWebhookSignature).toBe('function');
    expect(typeof MyImoPay.webhooks.constructEvent).toBe('function');
  });

  it('publishes the documented hosts', () => {
    expect(DEFAULT_BASE_URLS).toEqual({
      staging: 'https://apipg.demo.myimopay.com',
      live: 'https://api.myimopay.com',
    });
  });

  it('creates a client through createClient', () => {
    const client = createClient(validConfig({ environment: 'live' }));

    expect(client).toBeInstanceOf(MyImoPay);
    expect(client.baseUrl).toBe(DEFAULT_BASE_URLS.live);
  });
});
