import { MyImoPayValidationError } from '../errors';

/** Provider hard limit on `tx_ref`. */
export const MAX_REFERENCE_LENGTH = 20;

/** Characters the provider accepts in `tx_ref`. */
export const REFERENCE_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Validates a merchant-supplied reference.
 *
 * `tx_ref` is the provider's idempotency key and is capped at 20 characters.
 * Rejecting a bad reference locally is far cheaper than a 400 after the payer
 * has already been sent to checkout.
 */
export function assertReference(reference: unknown, field = 'reference'): string {
  void reference;
  void field;
  throw new MyImoPayValidationError('not implemented: assertReference', field);
}

/**
 * Builds a reference that always fits the provider's 20-character limit.
 *
 * With a seed (`"inv-1042"`), the seed is sanitised and kept readable; with no
 * seed, a short random suffix is used. The result is deterministic for a seed
 * plus a supplied random source, which is what the tests rely on.
 */
export function createReference(seed?: string, random?: () => number): string {
  void seed;
  void random;
  throw new Error('not implemented: createReference');
}
