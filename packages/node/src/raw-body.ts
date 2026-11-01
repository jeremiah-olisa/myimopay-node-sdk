// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import { MyImoPayValidationError } from '@myimopay/core';

/** Ceiling on a buffered webhook body. Signatures are computed over all of it. */
const MAX_RAW_BODY_BYTES = 1_048_576;

const RAW_BODY_GUARD_MESSAGE =
  'Webhook signatures are computed over the raw request bytes, so the body must arrive unparsed. Express: app.post("/webhooks/myimopay", express.raw({ type: \'application/json\' }), (req, res) => { const raw = req.body.toString(); }). Next.js route handler: const raw = await req.text(). Pass that string to constructEvent; re-serialising a parsed object changes key order and whitespace and can never match the digest.';

/**
 * Drains a request body into a string.
 *
 * Signatures are computed over the exact bytes the provider sent, so a webhook
 * handler must read the raw stream once and verify *before* any JSON parsing.
 * Decoding is streaming, so a multi-byte character split across chunks survives.
 */
export async function readRawBody(source: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;

  for await (const chunk of source) {
    bytes += chunk.byteLength;

    if (bytes > MAX_RAW_BODY_BYTES) {
      throw new MyImoPayValidationError(
        `Webhook body exceeds the ${MAX_RAW_BODY_BYTES} byte (1 MiB) limit and was not buffered. Reject oversized deliveries instead of reading them whole.`,
        'body',
      );
    }

    body += decoder.decode(chunk, { stream: true });
  }

  return body + decoder.decode();
}

/**
 * Guards the most common webhook mistake: a framework that already parsed the
 * body (`req.body` is an object). Re-serialising it changes key order and
 * whitespace, so the digest can never match — throw instead of failing open.
 *
 * Throws `MyImoPayValidationError` when handed anything that is not a string or
 * raw bytes.
 */
export function assertRawBodyString(body: unknown): string {
  if (typeof body === 'string') return body;

  if (body instanceof Uint8Array) return new TextDecoder().decode(body);

  const shape =
    body === null
      ? 'null'
      : Array.isArray(body)
        ? 'an array'
        : typeof body === 'object'
          ? 'a parsed object'
          : `a ${typeof body}`;

  throw new MyImoPayValidationError(`${RAW_BODY_GUARD_MESSAGE} Received ${shape}.`, 'body');
}
