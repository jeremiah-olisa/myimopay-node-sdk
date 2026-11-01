// @sdk-implemented-by: F1-transport

/**
 * URL and query-string helpers. Kept in core so both packages build identical
 * request shapes from identical inputs.
 */

import { MyImoPayValidationError } from '../errors';

const PROTOCOL_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * Joins a base URL and a path without doubling or dropping slashes.
 *
 * The scheme separator (`https://`) is never collapsed: a naive slash
 * normalisation would turn it into `https:/` and silently break TLS.
 */
export function joinUrl(baseUrl: string, path: string): string {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new MyImoPayValidationError('A non-empty base URL is required.', 'baseUrl');
  }
  if (typeof path !== 'string' || path.trim() === '') {
    throw new MyImoPayValidationError('A non-empty request path is required.', 'path');
  }

  const prefix = PROTOCOL_PREFIX.exec(baseUrl)?.[0] ?? '';
  const remainder = baseUrl.slice(prefix.length).replace(/\/+$/, '');
  if (remainder === '') {
    // A protocol-only base (`https://`) keeps its separator and takes the
    // path without a second leading slash.
    return `${prefix}${path.replace(/^\/+/, '')}`;
  }

  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${prefix}${remainder}${suffix}`;
}

/**
 * Serialises defined values only. Numbers and booleans are stringified, keys
 * and values are percent-encoded, and the result carries no leading `?`.
 */
export function buildQuery(query: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}
