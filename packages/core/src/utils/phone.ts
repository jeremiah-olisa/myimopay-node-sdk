// @sdk-implemented-by: F2-primitives
import { MyImoPayValidationError } from '../errors';

/** Formatting noise the provider and callers sprinkle into phone numbers. */
const SEPARATORS = /[\s\-().]/g;

const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Nigerian mobile numbers carry a 10-digit national number starting 7, 8 or 9
 * (070/080/081/090/091…). Anything else is a landline or another country.
 */
const NATIONAL_MOBILE = /^[789][0-9]{9}$/;

const ACCEPTED_FORMS = '08031234567, 8031234567, 2348031234567 or +2348031234567';

/** Renders the offending value for an error message without coercing objects. */
function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}

function expectedMessage(subject: string, value: unknown): string {
  return `${subject} must be a Nigerian mobile number such as +2348031234567 (accepted forms: ${ACCEPTED_FORMS}); received ${show(value)}.`;
}

/** Returns the E.164 form, or `null` when the input is not a Nigerian mobile. */
function toE164(phone: string): string | null {
  const compact = phone.replace(SEPARATORS, '');
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  if (digits === '' || !DIGITS_ONLY.test(digits)) return null;

  let national: string;
  if (digits.length === 13 && digits.startsWith('234')) {
    // +234…/234…
    national = digits.slice(3);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    // 0803…
    national = digits.slice(1);
  } else if (digits.length === 10) {
    // 803…
    national = digits;
  } else {
    return null;
  }

  return NATIONAL_MOBILE.test(national) ? `+234${national}` : null;
}

/**
 * Normalises a Nigerian mobile number to E.164 (`+2348031234567`).
 *
 * Accepted inputs: `08031234567`, `8031234567`, `2348031234567`,
 * `+2348031234567`, with optional spaces, dashes, dots or brackets.
 * Anything that is not a Nigerian number throws instead of being guessed at.
 */
export function normalizeNigerianPhone(phone: string): string {
  const normalized = typeof phone === 'string' ? toE164(phone) : null;
  if (normalized === null) {
    throw new MyImoPayValidationError(expectedMessage('phone', phone));
  }
  return normalized;
}

/** Validates and returns the normalised number. */
export function assertPhone(phone: unknown, field = 'customer.mobile'): string {
  const normalized = typeof phone === 'string' ? toE164(phone) : null;
  if (normalized === null) {
    throw new MyImoPayValidationError(expectedMessage(field, phone), field);
  }
  return normalized;
}
