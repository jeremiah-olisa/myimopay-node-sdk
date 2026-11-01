// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import { describe, expect, it } from 'bun:test';
import { isMyImoPayError } from '@core/errors';
import type { DebugEvent } from '@core/types/debug';
import type { MyImoPayConfig } from '@node/config';
import { DEFAULT_BASE_URLS, resolveConfig } from '@node/config';

const PUBLIC_KEY = 'pk_test_1234567890';

function validConfig(overrides: Partial<MyImoPayConfig> = {}): MyImoPayConfig {
  return { environment: 'staging', publicKey: PUBLIC_KEY, ...overrides };
}

/** Asserts the failure is a fail-fast `INVALID_CONFIG` whose message names the rule. */
function expectInvalidConfig(config: MyImoPayConfig, message: RegExp): void {
  let thrown: unknown;

  try {
    resolveConfig(config);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeDefined();
  expect(isMyImoPayError(thrown)).toBe(true);

  if (!isMyImoPayError(thrown)) return;

  expect(thrown.code).toBe('INVALID_CONFIG');
  expect(thrown.message).toMatch(message);
}

describe('resolveConfig', () => {
  describe('defaults', () => {
    it('resolves the staging host, timeout, retry policy and user agent', () => {
      const resolved = resolveConfig(validConfig());

      expect(resolved.environment).toBe('staging');
      expect(resolved.baseUrl).toBe(DEFAULT_BASE_URLS.staging);
      expect(resolved.baseUrl).toBe('https://apipg.demo.myimopay.com');
      expect(resolved.publicKey).toBe(PUBLIC_KEY);
      expect(resolved.secretKey).toBeUndefined();
      expect(resolved.publicKeyHeader).toBe('xp-key');
      expect(resolved.secretKeyHeader).toBe('sp-key');
      expect(resolved.timeoutMs).toBe(20_000);
      expect(resolved.retry).toEqual({ attempts: 3, baseDelayMs: 300, maxDelayMs: 5000 });
      expect(resolved.headers).toEqual({});
      expect(resolved.maxAmount).toBeUndefined();
      expect(typeof resolved.fetch).toBe('function');
      expect(resolved.onDebug).toBeUndefined();
      expect(resolved.userAgent).toMatch(/^myimopay-node\/\d+\.\d+\.\d+$/);
    });

    it('resolves the live host', () => {
      const resolved = resolveConfig(validConfig({ environment: 'live' }));

      expect(resolved.baseUrl).toBe('https://api.myimopay.com');
    });

    it('uses the default fetch when none is supplied', () => {
      expect(resolveConfig(validConfig()).fetch).toBe(globalThis.fetch);
    });
  });

  describe('overrides', () => {
    it('honours baseUrl instead of the environment default', () => {
      const resolved = resolveConfig(
        validConfig({ baseUrl: 'https://proxy.example.test/gateway' }),
      );

      expect(resolved.baseUrl).toBe('https://proxy.example.test/gateway');
      expect(resolved.environment).toBe('staging');
    });

    it('trims keys and keeps the secret key when supplied', () => {
      const resolved = resolveConfig(
        validConfig({ publicKey: `  ${PUBLIC_KEY}  `, secretKey: '  sk_test_1234567890  ' }),
      );

      expect(resolved.publicKey).toBe(PUBLIC_KEY);
      expect(resolved.secretKey).toBe('sk_test_1234567890');
    });

    it('honours timeout, retry, headers, guardrail, fetch and onDebug', () => {
      const events: DebugEvent[] = [];
      const fetch = async () => {
        throw new Error('unused');
      };

      const resolved = resolveConfig(
        validConfig({
          timeoutMs: 5000,
          retry: { attempts: 5, baseDelayMs: 100, maxDelayMs: 2000 },
          headers: { 'x-tenant': 'acme' },
          publicKeyHeader: 'mp-key',
          secretKeyHeader: 'mp-secret',
          maxAmount: 25_000,
          fetch,
          onDebug: (event) => events.push(event),
        }),
      );

      expect(resolved.timeoutMs).toBe(5000);
      expect(resolved.retry).toEqual({ attempts: 5, baseDelayMs: 100, maxDelayMs: 2000 });
      expect(resolved.headers).toEqual({ 'x-tenant': 'acme' });
      expect(resolved.publicKeyHeader).toBe('mp-key');
      expect(resolved.secretKeyHeader).toBe('mp-secret');
      expect(resolved.maxAmount).toBe(25_000);
      expect(resolved.fetch).toBe(fetch);

      resolved.onDebug?.({ type: 'request', method: 'GET', path: '/ping', attempt: 1 });
      expect(events).toHaveLength(1);
    });

    it('lifts the default retry ceiling above a large base delay', () => {
      const resolved = resolveConfig(validConfig({ retry: { baseDelayMs: 8000 } }));

      expect(resolved.retry.baseDelayMs).toBe(8000);
      expect(resolved.retry.maxDelayMs).toBe(8000);
    });

    it('returns its own headers object so the caller cannot mutate the client', () => {
      const headers = { 'x-tenant': 'acme' };

      const resolved = resolveConfig(validConfig({ headers }));

      expect(resolved.headers).not.toBe(headers);
    });
  });

  describe('environment', () => {
    it('rejects a missing environment at runtime', () => {
      expectInvalidConfig(
        { publicKey: PUBLIC_KEY } as unknown as MyImoPayConfig,
        /environment is required/,
      );
    });

    it('rejects an unknown environment', () => {
      expectInvalidConfig(
        { environment: 'production', publicKey: PUBLIC_KEY } as unknown as MyImoPayConfig,
        /must be 'staging' or 'live'/,
      );
    });
  });

  describe('credentials', () => {
    it('rejects an empty public key', () => {
      expectInvalidConfig(validConfig({ publicKey: '   ' }), /publicKey must not be empty/);
    });

    it('rejects a short public key', () => {
      expectInvalidConfig(validConfig({ publicKey: 'pk_1' }), /at least 8 characters/);
    });

    it('rejects a non-string public key', () => {
      expectInvalidConfig(
        validConfig({ publicKey: 42 as unknown as string }),
        /publicKey must be a string/,
      );
    });

    it('never echoes key material in the message', () => {
      let thrown: unknown;

      try {
        resolveConfig(validConfig({ publicKey: 'short' }));
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).not.toContain('short');
    });

    it('rejects an empty secret key', () => {
      expectInvalidConfig(validConfig({ secretKey: '  ' }), /secretKey must not be empty/);
    });
  });

  describe('baseUrl', () => {
    const baseUrlRule = /baseUrl must be an absolute https URL without embedded credentials/;

    it('rejects a plain http URL', () => {
      expectInvalidConfig(validConfig({ baseUrl: 'http://api.test' }), baseUrlRule);
    });

    it('rejects a relative URL', () => {
      expectInvalidConfig(validConfig({ baseUrl: '/gateway' }), baseUrlRule);
    });

    it('rejects an empty URL', () => {
      expectInvalidConfig(validConfig({ baseUrl: '  ' }), baseUrlRule);
    });

    it('rejects embedded credentials', () => {
      expectInvalidConfig(validConfig({ baseUrl: 'https://user:pass@api.test' }), baseUrlRule);
    });
  });

  describe('timeoutMs', () => {
    it('rejects zero', () => {
      expectInvalidConfig(
        validConfig({ timeoutMs: 0 }),
        /timeoutMs must be a number greater than 0/,
      );
    });

    it('rejects a value above the ceiling', () => {
      expectInvalidConfig(validConfig({ timeoutMs: 120_001 }), /at most 120000/);
    });

    it('rejects NaN', () => {
      expectInvalidConfig(validConfig({ timeoutMs: Number.NaN }), /timeoutMs/);
    });
  });

  describe('retry', () => {
    it('rejects a non-integer attempts value', () => {
      expectInvalidConfig(validConfig({ retry: { attempts: 2.5 } }), /attempts must be an integer/);
    });

    it('rejects zero attempts', () => {
      expectInvalidConfig(validConfig({ retry: { attempts: 0 } }), /between 1 and 10/);
    });

    it('rejects more than ten attempts', () => {
      expectInvalidConfig(validConfig({ retry: { attempts: 11 } }), /between 1 and 10/);
    });

    it('rejects a zero base delay', () => {
      expectInvalidConfig(
        validConfig({ retry: { baseDelayMs: 0 } }),
        /baseDelayMs must be an integer/,
      );
    });

    it('rejects a base delay above ten seconds', () => {
      expectInvalidConfig(validConfig({ retry: { baseDelayMs: 10_001 } }), /between 1 and 10000/);
    });

    it('rejects a ceiling below the base delay', () => {
      expectInvalidConfig(
        validConfig({ retry: { baseDelayMs: 5000, maxDelayMs: 1000 } }),
        /maxDelayMs must be a number greater than or equal to/,
      );
    });
  });

  describe('maxAmount', () => {
    it('rejects zero', () => {
      expectInvalidConfig(validConfig({ maxAmount: 0 }), /maxAmount must be greater than 0/);
    });

    it('rejects a negative amount', () => {
      expectInvalidConfig(validConfig({ maxAmount: -5 }), /maxAmount must be greater than 0/);
    });

    it('rejects an amount above one billion', () => {
      expectInvalidConfig(validConfig({ maxAmount: 1_000_000_001 }), /at most 1000000000/);
    });
  });

  describe('headers', () => {
    it('rejects upper-case names', () => {
      expectInvalidConfig(validConfig({ headers: { 'X-Tenant': 'acme' } }), /must be lowercase/);
    });

    it('rejects a name with an underscore', () => {
      expectInvalidConfig(
        validConfig({ headers: Object.fromEntries([['x_tenant', 'acme']]) }),
        /must match/,
      );
    });

    it('rejects the reserved host header', () => {
      expectInvalidConfig(validConfig({ headers: { host: 'evil.test' } }), /managed by the SDK/);
    });

    it('rejects the reserved authorization header', () => {
      expectInvalidConfig(
        validConfig({ headers: { authorization: 'Bearer sk_live_123' } }),
        /managed by the SDK/,
      );
    });

    it('rejects the reserved content-type header', () => {
      expectInvalidConfig(
        validConfig({ headers: { 'content-type': 'text/plain' } }),
        /managed by the SDK/,
      );
    });

    it('rejects credential headers routed through the key header overrides', () => {
      expectInvalidConfig(
        validConfig({ publicKeyHeader: 'authorization' }),
        /publicKeyHeader cannot be "authorization"/,
      );
    });

    it('rejects a non-lowercase key header override', () => {
      expectInvalidConfig(validConfig({ secretKeyHeader: 'SP-KEY' }), /must be lowercase/);
    });

    it('rejects header values with line breaks', () => {
      expectInvalidConfig(
        validConfig({ headers: { 'x-note': 'a\r\nx-injected: 1' } }),
        /line breaks/,
      );
    });

    it('rejects a non-string header value', () => {
      expectInvalidConfig(
        validConfig({ headers: { 'x-note': 5 as unknown as string } }),
        /must be a string/,
      );
    });
  });

  it('rejects a non-object config', () => {
    expectInvalidConfig(null as unknown as MyImoPayConfig, /must be an object/);
  });
});
