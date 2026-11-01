/**
 * URL and query-string helpers. Kept in core so both packages build identical
 * request shapes from identical inputs.
 */

/** Joins a base URL and a path without doubling or dropping slashes. */
export function joinUrl(baseUrl: string, path: string): string {
  void baseUrl;
  void path;
  throw new Error('not implemented: joinUrl');
}

/** Serialises defined values only; arrays become repeated keys. */
export function buildQuery(query: Record<string, string | number | boolean | undefined>): string {
  void query;
  throw new Error('not implemented: buildQuery');
}
