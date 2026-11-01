// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import { describe, expect, it } from 'bun:test';
import { isMyImoPayError } from '@core/errors';
import type { WebhookEvent } from '@node/webhooks';
import { constructEvent, signWebhookPayload, verifyWebhookSignature } from '@node/webhooks';

const SECRET = 'whsec_test_shared_secret';

/** HMAC-SHA256("hello", key="secret"), computed independently of the SDK. */
const KNOWN_SIGNATURE = '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b';

/** HMAC-SHA256('{"data":1}', key="whsec_test"), computed independently of the SDK. */
const KNOWN_BODY_SIGNATURE = '459f0528740b4c7ef5a90c313d44a0962ce43027de669930f30eda45ec16dd23';

/**
 * Builds a provider payload from `[field, value]` pairs.
 *
 * Provider fields are snake_case by nature; pairs keep the fixture readable
 * without a literal snake_case object key, and a later pair overrides an
 * earlier one so a test can change or drop a field.
 */
function payload(
  overrides: ReadonlyArray<readonly [string, unknown]> = [],
): Record<string, unknown> {
  return Object.fromEntries([
    ['tx_reference', 'TX-1042'],
    ['provider_reference', 'PRV-9001'],
    ['status', 2],
    ['is_settled', true],
    ['paid_amount', '1500.00'],
    ['charged_amount', '1515.00'],
    ['currency', 'ngn'],
    ['id', 'evt_123'],
    ...overrides,
  ]);
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error('expected the call to throw');
}

function expectWebhookError(fn: () => unknown, message: RegExp): void {
  const error = capture(fn);

  expect(isMyImoPayError(error)).toBe(true);

  if (!isMyImoPayError(error)) return;

  expect(error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  expect(error.message).toMatch(message);
}

/** Signs and delivers a JSON payload the way a webhook endpoint would. */
function deliver(data: unknown, options: { secret: string } = { secret: SECRET }): WebhookEvent {
  const body = JSON.stringify(data);

  return constructEvent(body, signWebhookPayload(body, options.secret), options);
}

describe('signWebhookPayload', () => {
  it('matches an independently computed HMAC-SHA256 vector', () => {
    expect(signWebhookPayload('hello', 'secret')).toBe(KNOWN_SIGNATURE);
  });

  it('matches a realistic JSON body vector', () => {
    expect(signWebhookPayload('{"data":1}', 'whsec_test')).toBe(KNOWN_BODY_SIGNATURE);
  });

  it('emits lower-case hex', () => {
    expect(signWebhookPayload('{"a":1}', SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to sign with an empty secret', () => {
    expectWebhookError(() => signWebhookPayload('{"a":1}', '   '), /without a secret/);
  });
});

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ data: payload() });

  it('accepts the digest it produced', () => {
    expect(verifyWebhookSignature(body, signWebhookPayload(body, SECRET), SECRET)).toBe(true);
  });

  it('accepts an upper-case digest', () => {
    expect(
      verifyWebhookSignature(body, signWebhookPayload(body, SECRET).toUpperCase(), SECRET),
    ).toBe(true);
  });

  it('accepts raw bytes', () => {
    const bytes = new TextEncoder().encode(body);

    expect(verifyWebhookSignature(bytes, signWebhookPayload(body, SECRET), SECRET)).toBe(true);
  });

  it('rejects a wrong digest', () => {
    expect(verifyWebhookSignature(body, 'a'.repeat(64), SECRET)).toBe(false);
  });

  it('rejects a missing digest', () => {
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, '', SECRET)).toBe(false);
  });

  it('rejects a malformed digest without throwing', () => {
    expect(verifyWebhookSignature(body, 'deadbeef', SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'zz'.repeat(32), SECRET)).toBe(false);
  });

  it('rejects an empty secret', () => {
    const signature = signWebhookPayload(body, SECRET);

    expect(verifyWebhookSignature(body, signature, '')).toBe(false);
    expect(verifyWebhookSignature(body, signature, '   ')).toBe(false);
  });

  it('rejects an empty body', () => {
    expect(verifyWebhookSignature('', signWebhookPayload('', SECRET), SECRET)).toBe(false);
    expect(verifyWebhookSignature(new Uint8Array(), signWebhookPayload('', SECRET), SECRET)).toBe(
      false,
    );
  });

  it('rejects a tampered body', () => {
    const signature = signWebhookPayload(body, SECRET);

    expect(verifyWebhookSignature(`${body} `, signature, SECRET)).toBe(false);
  });
});

describe('constructEvent', () => {
  it('projects an { header, data } envelope', () => {
    const data = payload();
    const header = Object.fromEntries([['is_success', true]]);
    const envelope = { header, data };

    const event = deliver(envelope);

    expect(event.reference).toBe('TX-1042');
    expect(event.providerReference).toBe('PRV-9001');
    expect(event.status).toBe('succeeded');
    expect(event.rawStatus).toBe(2);
    expect(event.isSettled).toBe(true);
    expect(event.amountPaid).toBe(1500);
    expect(event.currency).toBe('NGN');
    expect(event.eventId).toBe('evt_123');
    expect(event.raw).toEqual(envelope);
  });

  it('projects a bare payload', () => {
    const data = payload();

    const event = deliver(data);

    expect(event.reference).toBe('TX-1042');
    expect(event.status).toBe('succeeded');
    expect(event.raw).toEqual(data);
  });

  it('accepts a numeric-string status', () => {
    const event = deliver({ data: payload([['status', '2']]) });

    expect(event.rawStatus).toBe(2);
    expect(event.status).toBe('succeeded');
  });

  it('lets is_settled win over a non-terminal status', () => {
    const event = deliver({ data: payload([['status', 1]]) });

    expect(event.status).toBe('succeeded');
    expect(event.isSettled).toBe(true);
  });

  it('maps an unknown status to unknown', () => {
    const event = deliver({
      data: payload([
        ['status', 9],
        ['is_settled', false],
      ]),
    });

    expect(event.status).toBe('unknown');
    expect(event.rawStatus).toBe(9);
  });

  it('maps a free-text status to unknown without failing the delivery', () => {
    const event = deliver({
      data: payload([
        ['status', 'pending review'],
        ['is_settled', false],
      ]),
    });

    expect(event.status).toBe('unknown');
    expect(event.rawStatus).toBeNull();
  });

  it('falls back to charged_amount and then to zero', () => {
    const charged = deliver({ data: payload([['paid_amount', undefined]]) });
    const missing = deliver({
      data: payload([
        ['paid_amount', undefined],
        ['charged_amount', undefined],
      ]),
    });

    expect(charged.amountPaid).toBe(1515);
    expect(missing.amountPaid).toBe(0);
  });

  it('defaults the currency to NGN', () => {
    const event = deliver({ data: payload([['currency', undefined]]) });

    expect(event.currency).toBe('NGN');
  });

  it('accepts an identifier as the event id', () => {
    const event = deliver({
      data: payload([
        ['id', undefined],
        ['identifier', 'delivery-7'],
      ]),
    });

    expect(event.eventId).toBe('delivery-7');
  });

  it('rejects a payload with no transaction reference', () => {
    expectWebhookError(
      () => deliver({ data: payload([['tx_reference', undefined]]) }),
      /no transaction reference/,
    );
  });

  it('rejects a delivery whose signature does not match', () => {
    const body = JSON.stringify({ data: payload() });
    const error = capture(() => constructEvent(body, 'a'.repeat(64), { secret: SECRET }));

    expect(isMyImoPayError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect((error as Error).message).toMatch(/raw request body/);
  });

  it('rejects a delivery with no signature at all', () => {
    const body = JSON.stringify({ data: payload() });

    expectWebhookError(
      () => constructEvent(body, undefined, { secret: SECRET }),
      /verification failed/,
    );
  });

  it('verifies before parsing, so an unsigned non-JSON body is a signature error', () => {
    expectWebhookError(
      () => constructEvent('not json', null, { secret: SECRET }),
      /verification failed/,
    );
  });

  it('rejects an empty secret instead of accepting an unsigned delivery', () => {
    const body = JSON.stringify({ data: payload() });

    expectWebhookError(
      () => constructEvent(body, signWebhookPayload(body, SECRET), { secret: '  ' }),
      /secret is required/,
    );
  });

  it('rejects an empty headerName when one is provided', () => {
    const body = JSON.stringify({ data: payload() });

    expectWebhookError(
      () =>
        constructEvent(body, signWebhookPayload(body, SECRET), {
          secret: SECRET,
          headerName: '   ',
        }),
      /headerName must be a non-empty string/,
    );
  });

  it('treats headerName as descriptive only', () => {
    const body = JSON.stringify({ data: payload() });

    const event = constructEvent(body, signWebhookPayload(body, SECRET), {
      secret: SECRET,
      headerName: 'x-signature',
    });

    expect(event.reference).toBe('TX-1042');
  });

  it('rejects a JSON body it cannot parse after a valid signature', () => {
    const body = 'this is not json';

    expectWebhookError(
      () => constructEvent(body, signWebhookPayload(body, SECRET), { secret: SECRET }),
      /not valid JSON/,
    );
  });

  it('rejects a payload that is not an object', () => {
    expectWebhookError(() => deliver([1, 2, 3]), /must be a JSON object/);
  });

  it('accepts the raw body as bytes', () => {
    const body = JSON.stringify({ data: payload() });

    const event = constructEvent(new TextEncoder().encode(body), signWebhookPayload(body, SECRET), {
      secret: SECRET,
    });

    expect(event.reference).toBe('TX-1042');
  });
});
