// @sdk-owner: A0-contracts
// @sdk-phase: 1

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

/**
 * Builds a server config from environment variables.
 *
 * Reads `MYIMOPAY_ENVIRONMENT`, `MYIMOPAY_PUBLIC_KEY`, `MYIMOPAY_SECRET_KEY`,
 * `MYIMOPAY_BASE_URL`, `MYIMOPAY_TIMEOUT_MS` and `MYIMOPAY_MAX_AMOUNT`.
 *
 * `MYIMOPAY_ENVIRONMENT` has no default: guessing it is how a staging build
 * ends up billing a live account. Call it as `configFromEnv(process.env)`.
 */
export function configFromEnv(env?: EnvLike): MyImoPayConfig {
  void env;
  throw new Error('not implemented: configFromEnv');
}
