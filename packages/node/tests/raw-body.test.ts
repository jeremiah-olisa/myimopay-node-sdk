// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import { describe, expect, it } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import { assertRawBodyString, readRawBody } from '@node/raw-body';

const ONE_MIB = 1_048_576;

const encoder = new TextEncoder();

async function* streamOf(chunks: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error('expected the call to throw');
}

describe('readRawBody', () => {
  it('concatenates a multi-chunk stream', async () => {
    const body = await readRawBody(
      streamOf([
        encoder.encode('{"tx_ref":'),
        encoder.encode('"TX-1",'),
        encoder.encode('"ok":true}'),
      ]),
    );

    expect(body).toBe('{"tx_ref":"TX-1","ok":true}');
  });

  it('preserves a multi-byte character split across chunks', async () => {
    const bytes = encoder.encode('₦1500');

    const body = await readRawBody(streamOf([bytes.slice(0, 1), bytes.slice(1)]));

    expect(body).toBe('₦1500');
  });

  it('returns an empty string for an empty stream', async () => {
    expect(await readRawBody(streamOf([]))).toBe('');
  });

  it('accepts a body exactly at the limit', async () => {
    const body = await readRawBody(streamOf([new Uint8Array(ONE_MIB)]));

    expect(body).toHaveLength(ONE_MIB);
  });

  it('rejects a body beyond the limit with a validation error', async () => {
    const error = await readRawBody(streamOf([new Uint8Array(ONE_MIB + 1)])).then(
      () => {
        throw new Error('expected readRawBody to reject');
      },
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(MyImoPayValidationError);
    expect((error as MyImoPayValidationError).code).toBe('VALIDATION_ERROR');
    expect((error as MyImoPayValidationError).field).toBe('body');
    expect((error as MyImoPayValidationError).message).toMatch(/1 MiB/);
  });

  it('counts the whole stream, not just the first chunk', async () => {
    const half = new Uint8Array(ONE_MIB / 2 + 1);

    await expect(readRawBody(streamOf([half, half]))).rejects.toBeInstanceOf(
      MyImoPayValidationError,
    );
  });
});

describe('assertRawBodyString', () => {
  it('returns a string unchanged', () => {
    expect(assertRawBodyString('{"a":1}')).toBe('{"a":1}');
  });

  it('decodes raw bytes', () => {
    expect(assertRawBodyString(encoder.encode('{"a":1}'))).toBe('{"a":1}');
  });

  it('explains how to keep the body raw when handed a parsed object', () => {
    const error = capture(() => assertRawBodyString({ a: 1 }));

    expect(error).toBeInstanceOf(MyImoPayValidationError);
    expect((error as MyImoPayValidationError).field).toBe('body');

    const message = (error as Error).message;

    expect(message).toContain("express.raw({ type: 'application/json' })");
    expect(message).toContain('req.body.toString()');
    expect(message).toContain('await req.text()');
    expect(message).toContain('a parsed object');
  });

  it('rejects null and arrays', () => {
    expect(() => assertRawBodyString(null)).toThrow(MyImoPayValidationError);
    expect(() => assertRawBodyString([1, 2])).toThrow(MyImoPayValidationError);
    expect(() => assertRawBodyString(undefined)).toThrow(MyImoPayValidationError);
  });
});
