// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import { describe, expect, it } from 'bun:test';
import { isMyImoPayError } from '@core/errors';
import { resolveConfig } from '@node/config';
import type { EnvLike } from '@node/env';
import { configFromEnv } from '@node/env';

const PUBLIC_KEY = 'pk_test_1234567890';

/**
 * Builds an env object from `[name, value]` pairs.
 *
 * Written this way because the variables are SCREAMING_SNAKE by nature and a
 * literal object key would violate the repo's camelCase key convention.
 */
function envOf(pairs: ReadonlyArray<readonly [string, string]>): EnvLike {
  return Object.fromEntries(pairs);
}

/** A complete, valid environment plus any overrides (later pairs win). */
function env(pairs: ReadonlyArray<readonly [string, string]> = []): EnvLike {
  return envOf([
    ['MYIMOPAY_ENVIRONMENT', 'staging'],
    ['MYIMOPAY_PUBLIC_KEY', PUBLIC_KEY],
    ...pairs,
  ]);
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error('expected the call to throw');
}

function expectInvalidConfig(fn: () => unknown, message: RegExp): void {
  const error = capture(fn);

  expect(isMyImoPayError(error)).toBe(true);

  if (!isMyImoPayError(error)) return;

  expect(error.code).toBe('INVALID_CONFIG');
  expect(error.message).toMatch(message);
}

describe('configFromEnv', () => {
  it('maps every supported variable', () => {
    const config = configFromEnv(
      env([
        ['MYIMOPAY_SECRET_KEY', 'sk_test_1234567890'],
        ['MYIMOPAY_BASE_URL', 'https://proxy.example.test'],
        ['MYIMOPAY_TIMEOUT_MS', '15000'],
        ['MYIMOPAY_MAX_AMOUNT', '25000'],
      ]),
    );

    expect(config.environment).toBe('staging');
    expect(config.publicKey).toBe(PUBLIC_KEY);
    expect(config.secretKey).toBe('sk_test_1234567890');
    expect(config.baseUrl).toBe('https://proxy.example.test');
    expect(config.timeoutMs).toBe(15_000);
    expect(config.maxAmount).toBe(25_000);
  });

  it('omits optional keys that are not set', () => {
    const config = configFromEnv(env());

    expect(config.secretKey).toBeUndefined();
    expect(config.baseUrl).toBeUndefined();
    expect(config.timeoutMs).toBeUndefined();
    expect(config.maxAmount).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    const config = configFromEnv(
      env([
        ['MYIMOPAY_ENVIRONMENT', ' live '],
        ['MYIMOPAY_PUBLIC_KEY', `  ${PUBLIC_KEY}  `],
        ['MYIMOPAY_SECRET_KEY', '  sk_test_1234567890  '],
      ]),
    );

    expect(config.environment).toBe('live');
    expect(config.publicKey).toBe(PUBLIC_KEY);
    expect(config.secretKey).toBe('sk_test_1234567890');
  });

  it('treats an empty string as absent', () => {
    const config = configFromEnv(
      env([
        ['MYIMOPAY_SECRET_KEY', '   '],
        ['MYIMOPAY_MAX_AMOUNT', ''],
      ]),
    );

    expect(config.secretKey).toBeUndefined();
    expect(config.maxAmount).toBeUndefined();
  });

  it('treats an empty required variable as missing and names it', () => {
    expectInvalidConfig(
      () => configFromEnv(env([['MYIMOPAY_PUBLIC_KEY', '   ']])),
      /MYIMOPAY_PUBLIC_KEY/,
    );
    expectInvalidConfig(
      () => configFromEnv(env([['MYIMOPAY_ENVIRONMENT', '']])),
      /MYIMOPAY_ENVIRONMENT/,
    );
  });

  it('names the missing environment variable', () => {
    expectInvalidConfig(
      () => configFromEnv(envOf([['MYIMOPAY_PUBLIC_KEY', PUBLIC_KEY]])),
      /MYIMOPAY_ENVIRONMENT is not set/,
    );
  });

  it('names the missing public key variable', () => {
    expectInvalidConfig(
      () => configFromEnv(envOf([['MYIMOPAY_ENVIRONMENT', 'staging']])),
      /MYIMOPAY_PUBLIC_KEY is not set/,
    );
  });

  it('rejects an unknown environment value and names the variable', () => {
    expectInvalidConfig(
      () => configFromEnv(env([['MYIMOPAY_ENVIRONMENT', 'production']])),
      /MYIMOPAY_ENVIRONMENT must be 'staging' or 'live'/,
    );
  });

  it('rejects a non-numeric timeout and names the variable', () => {
    expectInvalidConfig(
      () => configFromEnv(env([['MYIMOPAY_TIMEOUT_MS', 'soon']])),
      /MYIMOPAY_TIMEOUT_MS must be a number/,
    );
  });

  it('rejects a non-numeric maximum amount and names the variable', () => {
    expectInvalidConfig(
      () => configFromEnv(env([['MYIMOPAY_MAX_AMOUNT', '25k']])),
      /MYIMOPAY_MAX_AMOUNT must be a number/,
    );
  });

  it('passes numeric bounds on to resolveConfig rather than swallowing them', () => {
    const config = configFromEnv(env([['MYIMOPAY_TIMEOUT_MS', '0']]));

    expect(config.timeoutMs).toBe(0);
    expectInvalidConfig(() => resolveConfig(config), /timeoutMs/);
  });

  it('ignores MYIMOPAY_DEBUG instead of installing a console logger', () => {
    const config = configFromEnv(env([['MYIMOPAY_DEBUG', '1']]));

    expect(config.onDebug).toBeUndefined();
  });

  it('reads nothing from the process when called with no argument', () => {
    expectInvalidConfig(() => configFromEnv(), /MYIMOPAY_ENVIRONMENT is not set/);
  });
});
