// @sdk-owner: A0-contracts
// @sdk-phase: 1

import { MyImoPayValidationError } from '@myimopay/core';

/**
 * Drains a request body into a string.
 *
 * Signatures are computed over the exact bytes the provider sent, so a webhook
 * handler must read the raw stream once and verify *before* any JSON parsing.
 */
export async function readRawBody(source: AsyncIterable<Uint8Array>): Promise<string> {
  void source;
  throw new Error('not implemented: readRawBody');
}

/**
 * Guards the most common webhook mistake: a framework that already parsed the
 * body (`req.body` is an object). Re-serialising it changes key order and
 * whitespace, so the digest can never match — throw instead of failing open.
 *
 * Throws `MyImoPayValidationError` when handed anything that is not a string.
 */
export function assertRawBodyString(body: unknown): string {
  void body;
  throw new MyImoPayValidationError('not implemented: assertRawBodyString', 'body');
}
