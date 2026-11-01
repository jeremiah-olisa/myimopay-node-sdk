// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import type { Environment } from '@myimopay/core';
import { MyImoPayError } from '@myimopay/core';
import type { MyImoPayConfig } from './config';

/**
 * The subset of `process.env` this SDK reads.
 *
 * Deliberately structural: `env.ts` never touches the `process` global, so the
 * caller decides what the process is allowed to see and tests can pass a plain
 * object.
 */
export interface EnvLike {
  readonly [key: string]: string | undefined;
}

const ENVIRONMENT_VAR = 'MYIMOPAY_ENVIRONMENT';
const PUBLIC_KEY_VAR = 'MYIMOPAY_PUBLIC_KEY';
const SECRET_KEY_VAR = 'MYIMOPAY_SECRET_KEY';
const BASE_URL_VAR = 'MYIMOPAY_BASE_URL';
const TIMEOUT_VAR = 'MYIMOPAY_TIMEOUT_MS';
const MAX_AMOUNT_VAR = 'MYIMOPAY_MAX_AMOUNT';

function invalidConfig(message: string): never {
  throw new MyImoPayError({ code: 'INVALID_CONFIG', message });
}

/** Reads a variable, treating absent and whitespace-only values as unset. */
function readString(env: EnvLike, name: string): string | undefined {
  const value = env[name];

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

function readRequired(env: EnvLike, name: string, hint: string): string {
  const value = readString(env, name);

  if (value === undefined) {
    invalidConfig(`${name} is not set. ${hint}`);
  }

  return value;
}

function readEnvironment(env: EnvLike): Environment {
  const value = readRequired(
    env,
    ENVIRONMENT_VAR,
    "Set it to 'staging' or 'live'. There is no default, because guessing it is how a staging build ends up billing a live account.",
  );

  if (value === 'staging' || value === 'live') return value;

  invalidConfig(`${ENVIRONMENT_VAR} must be 'staging' or 'live' (received "${value}").`);
}

function readNumber(env: EnvLike, name: string, hint: string): number | undefined {
  const value = readString(env, name);

  if (value === undefined) return undefined;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    invalidConfig(`${name} must be a number (received "${value}"). ${hint}`);
  }

  return parsed;
}

/**
 * Builds a server config from environment variables.
 *
 * Reads `MYIMOPAY_ENVIRONMENT`, `MYIMOPAY_PUBLIC_KEY`, `MYIMOPAY_SECRET_KEY`,
 * `MYIMOPAY_BASE_URL`, `MYIMOPAY_TIMEOUT_MS` and `MYIMOPAY_MAX_AMOUNT`.
 *
 * `MYIMOPAY_ENVIRONMENT` has no default: guessing it is how a staging build
 * ends up billing a live account. Call it as `configFromEnv(process.env)`.
 *
 * `MYIMOPAY_DEBUG` is read by no one: diagnostics go through the `onDebug`
 * callback, which has no console fallback, so this function never installs a
 * logger that could print merchant data into a log pipeline.
 */
export function configFromEnv(env: EnvLike = {}): MyImoPayConfig {
  const config: MyImoPayConfig = {
    environment: readEnvironment(env),
    publicKey: readRequired(
      env,
      PUBLIC_KEY_VAR,
      'Set it to your merchant public key, which is sent as the `xp-key` header.',
    ),
  };

  const secretKey = readString(env, SECRET_KEY_VAR);
  if (secretKey !== undefined) config.secretKey = secretKey;

  const baseUrl = readString(env, BASE_URL_VAR);
  if (baseUrl !== undefined) config.baseUrl = baseUrl;

  const timeoutMs = readNumber(
    env,
    TIMEOUT_VAR,
    'It is a whole number of milliseconds, for example 20000.',
  );
  if (timeoutMs !== undefined) config.timeoutMs = timeoutMs;

  const maxAmount = readNumber(
    env,
    MAX_AMOUNT_VAR,
    'It is a positive amount in major units, for example 25000.',
  );
  if (maxAmount !== undefined) config.maxAmount = maxAmount;

  return config;
}
