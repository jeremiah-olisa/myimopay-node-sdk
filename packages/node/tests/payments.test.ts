// @sdk-owner: A4-payments
// @sdk-phase: 1
// @sdk-implemented-by: A4-payments

import { describe, expect, it } from 'bun:test';
import { isMyImoPayError, type MyImoPayError, MyImoPayValidationError } from '@core/errors';
import { HttpClient } from '@core/http';
import type { PaymentStatus } from '@core/types/common';
import { PaymentsResource } from '@node/resources/payments';
import type { Responder } from './helpers/fake-http';
import { FakeHttpClient, ok, testHttpConfig } from './helpers/fake-http';

/** Runs a call expected to throw and returns the error for assertions. */
async function capture(run: () => Promise<unknown>): Promise<MyImoPayError> {
  try {
    await run();
  } catch (error) {
    if (isMyImoPayError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}

const PAYMENT_LINK = 'https://pay.myimopay.test/link/abc123';

const INITIATION_PAYLOAD = {
  tx_reference: 'prov-ref-1',
  payment_link: PAYMENT_LINK,
  expires_on: '2026-11-02T10:00:00.000Z',
};

const BASE_INPUT = {
  amount: 50,
  currency: 'ngn',
  reference: 'ref-1',
  customer: { fullName: 'Ada Lovelace', mobile: '08031234567', email: 'ada@example.com' },
};

function makePayments(
  responder: Responder,
  maxAmount?: number,
  customer?: {
    sanitizeName?: boolean;
    requireEmail?: boolean;
    emailFallbackDomain?: string;
  },
) {
  const http = new FakeHttpClient(responder);
  const payments = new PaymentsResource({
    http,
    maxAmount,
    customer:
      customer === undefined
        ? undefined
        : {
            sanitizeName: customer.sanitizeName ?? true,
            requireEmail: customer.requireEmail ?? true,
            emailFallbackDomain: customer.emailFallbackDomain,
          },
  });
  return { http, payments };
}

function constant(data: unknown): Responder {
  return () => ok(data);
}

/** The initiation payload as it goes on the wire; snake_case is the provider's. */
interface InitiateBody {
  tx_ref: string;
  amount: string;
  currency: string;
  customer_full_name: string;
  customer_mobile: string;
  customer_email?: string;
  callback_url?: string;
  settlement_order_id?: string;
}

/** The wire body of the last initiation, narrowed for assertions. */
function lastBody(http: FakeHttpClient): InitiateBody {
  const body = http.lastBody;
  if (typeof body !== 'object' || body === null) throw new Error('expected a request body');
  return body as InitiateBody;
}

describe('PaymentsResource.initiate', () => {
  it('posts the exact path, public auth and wire body', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    const result = await payments.initiate({
      ...BASE_INPUT,
      customer: {
        fullName: '  Ada   Lovelace ',
        mobile: '+234 803 123 4567',
        email: '  ada@example.com ',
      },
    });

    expect(http.lastPath).toBe('/vi/pay/initiate');
    expect(http.calls[0]?.method).toBe('POST');
    expect(http.calls[0]?.auth).toBe('public');
    // `tx_ref` is the provider's de-duplication key, so a retried write is safe.
    expect(http.calls[0]?.retryableWrite).toBe(true);
    expect(http.lastBody).toEqual({
      tx_ref: 'ref-1',
      amount: '50.00',
      currency: 'NGN',
      customer_full_name: 'Ada Lovelace',
      customer_mobile: '+2348031234567',
      customer_email: 'ada@example.com',
    });

    expect(result.reference).toBe('ref-1');
    expect(result.providerReference).toBe('prov-ref-1');
    expect(result.authorizationUrl).toBe(PAYMENT_LINK);
    expect(result.amount).toBe(50);
    expect(result.currency).toBe('NGN');
    expect(result.expiresAt).toEqual(new Date('2026-11-02T10:00:00.000Z'));
    expect(result.raw).toEqual(INITIATION_PAYLOAD);
  });

  it('sends a validated callback URL and the normalised phone', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    await payments.initiate({
      ...BASE_INPUT,
      customer: { fullName: 'Ada Lovelace', mobile: '8031234567', email: 'ada@example.com' },
      callbackUrl: 'https://shop.example/checkout/return',
    });

    const body = lastBody(http);
    expect(body.customer_email).toBe('ada@example.com');
    expect(body.callback_url).toBe('https://shop.example/checkout/return');
    expect(body.amount).toBe('50.00');
  });

  it('treats a whitespace-only email as missing and fails with an actionable error', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    const error = await capture(() =>
      payments.initiate({
        ...BASE_INPUT,
        customer: { fullName: 'Ada', mobile: '08031234567', email: '   ' },
      }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('customer.email is required');
    expect(http.calls.length).toBe(0);
  });

  it('omits the email only when the caller disables the requirement', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD), undefined, {
      requireEmail: false,
    });

    await payments.initiate({
      ...BASE_INPUT,
      customer: { fullName: 'Ada', mobile: '08031234567' },
    });

    expect('customer_email' in lastBody(http)).toBe(false);
  });

  it('derives an email from the phone when a fallback domain is configured', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD), undefined, {
      emailFallbackDomain: 'payments.example.com',
    });

    await payments.initiate({
      ...BASE_INPUT,
      customer: { fullName: 'Ada', mobile: '08031234567' },
    });

    expect(lastBody(http).customer_email).toBe('08031234567@payments.example.com');
  });

  it('rejects a malformed email before calling the provider', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    const error = await capture(() =>
      payments.initiate({
        ...BASE_INPUT,
        customer: { fullName: 'Ada', mobile: '08031234567', email: 'not-an-email' },
      }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('not a valid email');
    expect(http.calls.length).toBe(0);
  });

  it('sanitises a punctuation-heavy name and merges a lone initial', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    await payments.initiate({
      ...BASE_INPUT,
      customer: {
        fullName: "O'Brien-Okafor  H Chinedu!",
        mobile: '08031234567',
        email: 'ada@example.com',
      },
    });

    expect(lastBody(http).customer_full_name).toBe('OBrien Okafor HChinedu');
  });

  it('pads a single-word name so the provider accepts it', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    await payments.initiate({
      ...BASE_INPUT,
      customer: { fullName: 'Techcourt', mobile: '08031234567', email: 'ada@example.com' },
    });

    expect(lastBody(http).customer_full_name).toBe('Techcourt Customer');
  });

  it('sends the name verbatim when sanitisation is disabled', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD), undefined, {
      sanitizeName: false,
    });

    await payments.initiate({
      ...BASE_INPUT,
      customer: { fullName: 'Techcourt', mobile: '08031234567', email: 'ada@example.com' },
    });

    expect(lastBody(http).customer_full_name).toBe('Techcourt');
  });

  it('generates a reference that fits the provider limit', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    const result = await payments.initiate({
      amount: 10,
      customer: { fullName: 'Ada', mobile: '08031234567', email: 'ada@example.com' },
    });

    expect(result.reference).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(result.reference.length).toBeLessThanOrEqual(20);
    expect(lastBody(http).tx_ref).toBe(result.reference);
  });

  it('accepts any caller reference within the provider limits, such as a timestamp', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    await payments.initiate({ ...BASE_INPUT, reference: '1723456789012' });

    expect(lastBody(http).tx_ref).toBe('1723456789012');
  });

  it('rejects a reference longer than 20 characters and points at sanitizeReference', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    const error = await capture(() =>
      payments.initiate({ ...BASE_INPUT, reference: 'INV-2026-0001234567890' }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('20');
    expect(error.message).toContain('sanitizeReference');
    expect(http.calls.length).toBe(0);
  });

  it('falls back to the sent reference when the provider omits tx_reference', async () => {
    const { payments } = makePayments(constant({ payment_link: PAYMENT_LINK }));

    const result = await payments.initiate({ ...BASE_INPUT });

    expect(result.providerReference).toBe('ref-1');
  });

  it('falls back to a 24-hour expiry when expires_on is unusable', async () => {
    const { payments } = makePayments(
      constant({ ...INITIATION_PAYLOAD, expires_on: 'not-a-date' }),
    );
    const before = Date.now();

    const result = await payments.initiate({ ...BASE_INPUT });

    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
    expect(Number.isNaN(result.expiresAt.getTime())).toBe(false);
  });

  it('forwards per-call request options to the transport', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));
    const controller = new AbortController();

    await payments.initiate(
      { ...BASE_INPUT },
      {
        baseUrl: 'https://proxy.example',
        timeoutMs: 250,
        headers: { 'x-trace-id': 'abc' },
        signal: controller.signal,
      },
    );

    const call = http.calls[0];
    expect(call?.baseUrl).toBe('https://proxy.example');
    expect(call?.timeoutMs).toBe(250);
    expect(call?.headers).toEqual({ 'x-trace-id': 'abc' });
    expect(call?.signal).toBe(controller.signal);
  });

  it('rejects an initiation without a payment link as a malformed response', async () => {
    const { payments } = makePayments(constant({ tx_reference: 'prov-ref-1', expires_on: '' }));

    const error = await payments.initiate({ ...BASE_INPUT }).catch((reason: unknown) => reason);

    expect(isMyImoPayError(error)).toBe(true);
    expect((error as MyImoPayError).code).toBe('MALFORMED_RESPONSE');
  });

  it('rejects an amount above the configured maxAmount before any network call', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD), 100);

    const error = await payments
      .initiate({ ...BASE_INPUT, amount: 101 })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MyImoPayValidationError);
    expect((error as MyImoPayValidationError).field).toBe('amount');
    expect((error as Error).message).toContain('101');
    expect((error as Error).message).toContain('100');
    expect(http.calls).toHaveLength(0);
  });

  it('allows an amount exactly at maxAmount', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD), 100);

    await payments.initiate({ ...BASE_INPUT, amount: 100 });

    expect(http.calls).toHaveLength(1);
  });

  it('validates the amount, reference and customer before calling the provider', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    await expect(payments.initiate({ ...BASE_INPUT, amount: 50.005 })).rejects.toBeInstanceOf(
      MyImoPayValidationError,
    );
    await expect(
      payments.initiate({ ...BASE_INPUT, reference: 'x'.repeat(21) }),
    ).rejects.toBeInstanceOf(MyImoPayValidationError);
    await expect(
      payments.initiate({ ...BASE_INPUT, customer: { fullName: '   ', mobile: '08031234567' } }),
    ).rejects.toBeInstanceOf(MyImoPayValidationError);
    await expect(
      payments.initiate({ ...BASE_INPUT, customer: { fullName: 'Ada', mobile: '12345' } }),
    ).rejects.toBeInstanceOf(MyImoPayValidationError);
    await expect(
      payments.initiate({ ...BASE_INPUT, callbackUrl: 'http://shop.example/return' }),
    ).rejects.toBeInstanceOf(MyImoPayValidationError);

    expect(http.calls).toHaveLength(0);
  });
});

describe('PaymentsResource.initiateSplit', () => {
  it('uses the split path, secret auth and settlement order body', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    const result = await payments.initiateSplit({ ...BASE_INPUT, settlementOrderId: ' so-1 ' });

    expect(http.lastPath).toBe('/vi/pay/initiate/split');
    expect(http.calls[0]?.method).toBe('POST');
    expect(http.calls[0]?.auth).toBe('secret');
    expect(lastBody(http).settlement_order_id).toBe('so-1');
    expect(result.authorizationUrl).toBe(PAYMENT_LINK);
  });

  it('rejects an empty settlement order id locally', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    await expect(
      payments.initiateSplit({ ...BASE_INPUT, settlementOrderId: '  ' }),
    ).rejects.toBeInstanceOf(MyImoPayValidationError);
    expect(http.calls).toHaveLength(0);
  });

  it('lets the transport reject a missing secret key with INVALID_CONFIG', async () => {
    const http = new HttpClient(
      testHttpConfig({
        fetch: async () => {
          throw new Error('the secret-key check must run before fetch');
        },
      }),
    );
    const payments = new PaymentsResource({ http, maxAmount: undefined, customer: undefined });

    const error = await payments
      .initiateSplit({ ...BASE_INPUT, settlementOrderId: 'so-1' })
      .catch((reason: unknown) => reason);

    expect(isMyImoPayError(error)).toBe(true);
    expect((error as MyImoPayError).code).toBe('INVALID_CONFIG');
  });
});

describe('PaymentsResource.verify', () => {
  it('gets the exact verify path with public auth', async () => {
    const { http, payments } = makePayments(constant({ status: 2, tx_reference: 'ref-1' }));

    await payments.verify('ref-1');

    expect(http.lastPath).toBe('/vi/pay/verify/ref-1');
    expect(http.calls[0]?.method).toBe('GET');
    expect(http.calls[0]?.auth).toBe('public');
  });

  it('maps every provider status integer', async () => {
    const cases: ReadonlyArray<readonly [number | string, PaymentStatus]> = [
      [0, 'initiated'],
      [1, 'pending'],
      [2, 'succeeded'],
      [3, 'failed'],
      [4, 'expired'],
      [9, 'unknown'],
      ['2', 'succeeded'],
      ['', 'unknown'],
    ];

    for (const [rawStatus, expected] of cases) {
      const { payments } = makePayments(
        constant({ status: rawStatus, is_settled: false, tx_reference: 'ref-1' }),
      );

      const verified = await payments.verify('ref-1');

      expect(verified.status).toBe(expected);
    }
  });

  it('lets is_settled override a failed integer status', async () => {
    const { payments } = makePayments(
      constant({ status: 3, is_settled: true, tx_reference: 'ref-1' }),
    );

    const verified = await payments.verify('ref-1');

    expect(verified.status).toBe('succeeded');
    expect(verified.isSettled).toBe(true);
    expect(verified.rawStatus).toBe(3);
  });

  it('normalises numeric-string amounts, charge bearer, split flags and dates', async () => {
    const payload = {
      initial_amount: '50.00',
      charged_amount: '50.50',
      paid_amount: '50.50',
      payout_amount: '48.00',
      tax_amount: '0.50',
      fee_amount: '2.00',
      admin_fee_amount: '0.00',
      charge_bearer: 2,
      is_split: 'true',
      settlement_order_id: ' so-1 ',
      status: '1',
      is_settled: false,
      tx_reference: 'ref-1',
      provider_reference: 'prov-9',
      currency: 'ngn',
      expiration_time: '2026-11-02T10:00:00.000Z',
      created_on: '2026-11-01T09:00:00.000Z',
      payment_link: PAYMENT_LINK,
    };
    const { payments } = makePayments(constant(payload));

    const verified = await payments.verify('ref-1');

    expect(verified.reference).toBe('ref-1');
    expect(verified.providerReference).toBe('prov-9');
    expect(verified.status).toBe('pending');
    expect(verified.rawStatus).toBe(1);
    expect(verified.isSettled).toBe(false);
    expect(verified.currency).toBe('NGN');
    expect(verified.amountInitial).toBe(50);
    expect(verified.amountPaid).toBe(50.5);
    expect(verified.amountCharged).toBe(50.5);
    expect(verified.amountPayout).toBe(48);
    expect(verified.chargeBearer).toBe('customer');
    expect(verified.isSplit).toBe(true);
    expect(verified.settlementOrderId).toBe('so-1');
    expect(verified.expiresAt).toEqual(new Date('2026-11-02T10:00:00.000Z'));
    expect(verified.raw).toEqual(payload);
  });

  it('defaults missing amounts to 0 and falls back to charged_amount', async () => {
    const { payments } = makePayments(
      constant({ status: 2, charged_amount: '75.25', tx_reference: 'ref-1' }),
    );

    const verified = await payments.verify('ref-1');

    expect(verified.amountInitial).toBe(0);
    expect(verified.amountPaid).toBe(75.25);
    expect(verified.amountCharged).toBe(75.25);
    expect(verified.amountPayout).toBe(0);
    expect(verified.amountPaid).toBe(verified.amountCharged);
    expect(verified.chargeBearer).toBeNull();
    expect(verified.settlementOrderId).toBeNull();
    expect(verified.providerReference).toBeNull();
    expect(verified.currency).toBe('NGN');
  });

  it('maps invalid or missing dates to null', async () => {
    const { payments } = makePayments(
      constant({ status: 1, expiration_time: 'not-a-date', created_on: null }),
    );

    const verified = await payments.verify('ref-1');

    expect(verified.expiresAt).toBeNull();
  });

  it('falls back to the requested reference and id path for verifyById', async () => {
    const { http, payments } = makePayments(constant({ status: 1, id: 'internal-9' }));

    const verified = await payments.verifyById('internal-9');

    expect(http.lastPath).toBe('/vi/pay/verify/id/internal-9');
    expect(http.calls[0]?.auth).toBe('public');
    expect(verified.reference).toBe('internal-9');
  });

  it('rejects an empty reference or id before any network call', async () => {
    const { http, payments } = makePayments(constant({ status: 1 }));

    await expect(payments.verify('  ')).rejects.toBeInstanceOf(MyImoPayValidationError);
    await expect(payments.verifyById('')).rejects.toBeInstanceOf(MyImoPayValidationError);
    expect(http.calls).toHaveLength(0);
  });

  it('rejects a verification payload that is not an object', async () => {
    const { payments } = makePayments(constant(['not', 'a', 'record']));

    const error = await payments.verify('ref-1').catch((reason: unknown) => reason);

    expect(isMyImoPayError(error)).toBe(true);
    expect((error as MyImoPayError).code).toBe('MALFORMED_RESPONSE');
  });
});

describe('PaymentsResource.events', () => {
  it('is a bus, not a poller: nothing is requested until an event is emitted', async () => {
    const { http, payments } = makePayments(constant(INITIATION_PAYLOAD));

    const seen: string[] = [];
    const unsubscribe = payments.events.on('ref-1', {
      onSuccess: (event) => {
        seen.push(`success:${event.reference}`);
      },
      onClose: (outcome) => {
        seen.push(`close:${outcome}`);
      },
    });

    expect(payments.events.size).toBe(1);
    expect(http.calls.length).toBe(0);

    const delivered = await payments.events.emit({
      reference: 'ref-1',
      providerReference: 'prov-ref-1',
      status: 'succeeded',
      raw: null,
    });

    unsubscribe();
    expect(delivered).toBe(1);
    expect(seen).toEqual(['success:ref-1', 'close:succeeded']);
    expect(payments.events.size).toBe(0);
  });
});
