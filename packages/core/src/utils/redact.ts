// @sdk-implemented-by: F1-transport

/**
 * Redaction for anything that leaves the process: logs, debug hooks, error
 * payloads, telemetry. The rule is deny-by-default for values that look like
 * credentials, so a new field never leaks just because nobody updated a list.
 */

/**
 * `xp-key`, `sp-key`, `mp-key`, `uix-pky`, `authorization`, `cookie`,
 * `set-cookie` — case-insensitive, with the separator optional.
 */
const SECRET_KEY_PATTERN =
  /^(?:xp|sp|mp)[-_]?key$|^uix[-_]?pky$|^authorization$|^cookie$|^set-cookie$/i;

/** A long opaque token, optionally in `Bearer` form. */
const SECRET_VALUE_PATTERN = /^(?:bearer\s+\S+|[A-Za-z0-9._~+/-]{16,}={0,2})$/i;

/** A media type (`application/json`) is never a credential, however long. */
const MEDIA_TYPE_PATTERN = /^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+$/i;

const MASK = '***';
const CIRCULAR = '[Circular]';
const UNSERIALIZABLE = '[Unserializable]';

/** Masks a single value (`abcd***wxyz`), keeping enough to correlate support tickets. */
export function maskValue(value: string): string {
  if (value === '') return '';
  if (value.length > 12) return `${value.slice(0, 4)}${MASK}${value.slice(-4)}`;
  return MASK;
}

/** True when a header name or object key must never be logged verbatim. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key.trim());
}

/** True when a bare string is shaped like a credential. */
export function looksLikeSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERN.test(value.trim());
}

/** Returns a copy of `headers` with credential-bearing values masked. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    redacted[name] = shouldMaskHeaderValue(name, value) ? maskValue(value) : value;
  }
  return redacted;
}

/**
 * Deep-copies a value, masking anything that looks like a credential.
 * Handles cycles. Never throws.
 */
export function redact(value: unknown): unknown {
  try {
    return redactValue(value, new Set<object>());
  } catch {
    return UNSERIALIZABLE;
  }
}

function shouldMaskHeaderValue(name: string, value: string): boolean {
  if (isSecretKey(name)) return true;
  const trimmed = value.trim();
  if (MEDIA_TYPE_PATTERN.test(trimmed)) return false;
  return looksLikeSecretValue(trimmed);
}

function redactValue(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value === 'string') {
    return looksLikeSecretValue(value) ? maskValue(value) : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (ancestors.has(value)) return CIRCULAR;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, ancestors));
    }

    const source = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const child = source[key];
      copy[key] = isSecretKey(key) ? maskSecret(child) : redactValue(child, ancestors);
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

function maskSecret(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  return typeof value === 'string' ? maskValue(value) : MASK;
}

export { SECRET_KEY_PATTERN, SECRET_VALUE_PATTERN };
