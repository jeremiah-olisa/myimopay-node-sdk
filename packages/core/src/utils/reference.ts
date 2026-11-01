// @sdk-implemented-by: F2-primitives
import { MyImoPayValidationError } from '../errors';

/** Provider hard limit on `tx_ref`. */
export const MAX_REFERENCE_LENGTH = 20;

/** Characters the provider accepts in `tx_ref`. */
export const REFERENCE_PATTERN = /^[A-Za-z0-9._-]+$/;

/** A reference made only of separators carries no identity; the provider rejects it. */
const SEPARATORS_ONLY = /^[._-]+$/;

/** Suffix appended to a seeded reference: `-` plus four random characters. */
const SUFFIX_LENGTH = 4;

/** A reference with no seed is purely random, and fills the whole allowance. */
const RANDOM_ONLY_LENGTH = MAX_REFERENCE_LENGTH - SUFFIX_LENGTH;

/** Readable seed budget: the rest of the allowance belongs to `-<suffix>`. */
const MAX_SEED_LENGTH = MAX_REFERENCE_LENGTH - SUFFIX_LENGTH - 1;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Renders the offending value for an error message without coercing objects. */
function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}

/** One character per `random()` call, clamped so a bad source cannot yield `undefined`. */
function randomChars(length: number, random: () => number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    const roll = random();
    const unit = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.9999999999) : 0;
    out += ALPHABET.charAt(Math.floor(unit * ALPHABET.length));
  }
  return out;
}

/** Disallowed runs become `-`, separators are trimmed, and the tail is cut to fit. */
function sanitizeSeed(seed: string): string {
  const sanitized = seed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .slice(0, MAX_SEED_LENGTH)
    .replace(/[._-]+$/, '');
  return REFERENCE_PATTERN.test(sanitized) ? sanitized : '';
}

/**
 * Validates a merchant-supplied reference.
 *
 * `tx_ref` is the provider's idempotency key and is capped at 20 characters.
 * Rejecting a bad reference locally is far cheaper than a 400 after the payer
 * has already been sent to checkout.
 */
export function assertReference(reference: unknown, field = 'reference'): string {
  const expected =
    `${field} must be 1 to ${MAX_REFERENCE_LENGTH} characters long, may only use ` +
    '[A-Za-z0-9._-], and must contain at least one letter or digit';

  const hint = ', or pass your own identifier through sanitizeReference() first';

  if (typeof reference !== 'string') {
    throw new MyImoPayValidationError(`${expected}; received ${show(reference)}${hint}.`, field);
  }
  if (reference.length === 0 || reference.length > MAX_REFERENCE_LENGTH) {
    throw new MyImoPayValidationError(`${expected}; received ${show(reference)}${hint}.`, field);
  }
  if (!REFERENCE_PATTERN.test(reference) || SEPARATORS_ONLY.test(reference)) {
    throw new MyImoPayValidationError(`${expected}; received ${show(reference)}${hint}.`, field);
  }
  return reference;
}

/**
 * Coerces any caller identifier into something the provider accepts.
 *
 * Use this when your canonical id is not reference-shaped — invoice numbers
 * with slashes, UUIDs, timestamps with colons. It never throws: disallowed runs
 * become `-`, separators are trimmed, the value is cut to 20 characters, and an
 * identifier with nothing usable falls back to a random reference.
 *
 * The result is **not** re-seeded with a random suffix, so the same input
 * always maps to the same reference. That matters: `tx_ref` is the provider's
 * idempotency key, and a changing suffix would create a second payment.
 */
export function sanitizeReference(value: string, random: () => number = Math.random): string {
  if (typeof value !== 'string') return randomChars(MAX_REFERENCE_LENGTH, random);

  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '');

  if (cleaned === '') return randomChars(MAX_REFERENCE_LENGTH, random);

  const truncated = cleaned.slice(0, MAX_REFERENCE_LENGTH).replace(/[._-]+$/, '');
  return truncated === '' ? randomChars(MAX_REFERENCE_LENGTH, random) : truncated;
}

/**
 * Builds a reference that always fits the provider's 20-character limit.
 *
 * With a seed (`"inv-1042"`), the seed is sanitised and kept readable; with no
 * seed, a short random suffix is used. The result is deterministic for a seed
 * plus a supplied random source, which is what the tests rely on.
 */
export function createReference(seed?: string, random: () => number = Math.random): string {
  const head = typeof seed === 'string' ? sanitizeSeed(seed) : '';
  if (head === '') return randomChars(RANDOM_ONLY_LENGTH, random);
  return `${head}-${randomChars(SUFFIX_LENGTH, random)}`;
}
