/**
 * Customer-field normalisation.
 *
 * This is provider-behaviour code, not cosmetics: MyIMO Pay (like the other
 * Nigerian gateways) has rejected names that contain punctuation, a lone
 * one-letter word, or only a single word. Both production integrations in the
 * wild strip, merge and pad. The SDK does it by default, and the client can
 * switch it off when it wants full control.
 */

import { MyImoPayValidationError } from '../errors';

export interface CustomerNameOptions {
  /** Used only when nothing usable survives. Default `Valued Customer`. */
  fallback?: string;
  /** Provider-side length ceiling. Default 100. */
  maxLength?: number;
}

const DEFAULT_NAME_FALLBACK = 'Valued Customer';
const DEFAULT_NAME_MAX_LENGTH = 100;
const TWO_WORDS_SUFFIX = ' Customer';

/**
 * Produces a name the provider accepts.
 *
 * - Accents are folded to ASCII and every non-letter becomes a space, so
 *   `"O'Brien-Okafor  Chinedu!"` → `"OBrien Okafor Chinedu"`.
 * - A lone one-letter token is merged into its neighbour, because the provider
 *   rejects names containing a one-letter word: `"H careplus"` → `"Hcareplus"`.
 * - A single-word name gets a ` Customer` suffix, because the provider wants
 *   two words: `"Techcourt"` → `"Techcourt Customer"`.
 * - Anything unusable falls back to `"Valued Customer"` rather than sending an
 *   empty required field.
 */
export function sanitizeCustomerName(
  raw: string | null | undefined,
  options: CustomerNameOptions = {},
): string {
  const fallback = options.fallback ?? DEFAULT_NAME_FALLBACK;
  const maxLength = options.maxLength ?? DEFAULT_NAME_MAX_LENGTH;

  if (typeof raw !== 'string' || raw.trim() === '') return fallback;

  const ascii = raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z]+/g, ' ')
    .trim();

  const tokens = ascii.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return fallback;

  const merged: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token.length !== 1) {
      merged.push(token);
      continue;
    }

    const next = tokens[index + 1];
    if (next !== undefined) {
      merged.push(token + next);
      index += 1;
      continue;
    }

    const previous = merged.at(-1);
    if (previous !== undefined) {
      merged[merged.length - 1] = previous + token;
      continue;
    }

    merged.push(token);
  }

  let name = merged.join(' ');
  if (name === '') return fallback;
  if (!name.includes(' ')) name = `${name}${TWO_WORDS_SUFFIX}`;

  if (name.length > maxLength) {
    name = name.slice(0, maxLength).trimEnd();
    if (name === '') return fallback;
  }

  return name;
}

/**
 * Normalises an optional customer email.
 *
 * Missing, `null`, empty and whitespace-only values all mean "no email", which
 * the provider accepts. A value that is present but malformed throws, because
 * silently sending a broken address would fail later, at the provider, after
 * the payer has already been redirected.
 */
export function normalizeCustomerEmail(
  email: unknown,
  field = 'customer.email',
): string | undefined {
  if (email === undefined || email === null) return undefined;
  if (typeof email !== 'string') {
    throw new MyImoPayValidationError(`${field} must be a string when provided.`, field);
  }

  const trimmed = email.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
    throw new MyImoPayValidationError(`${field} is not a valid email address.`, field);
  }

  return trimmed;
}

/**
 * Derives a routable-looking email from a Nigerian phone number.
 *
 * Only used when the caller opts in with `customer.emailFallbackDomain`, for
 * flows (USSD, POS) where the payer genuinely has no email. Never on by default:
 * fabricating an address is a product decision, not an SDK default.
 */
export function deriveEmailFromPhone(phone: string, domain: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits === '') {
    throw new MyImoPayValidationError(
      'A phone number is required to derive an email address.',
      'customer.mobile',
    );
  }
  if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(domain.trim())) {
    throw new MyImoPayValidationError(
      'emailFallbackDomain must be a bare domain such as example.com.',
      'customer.emailFallbackDomain',
    );
  }

  const national = digits.startsWith('234') ? `0${digits.slice(3)}` : digits;
  return `${national}@${domain.trim().toLowerCase()}`;
}
