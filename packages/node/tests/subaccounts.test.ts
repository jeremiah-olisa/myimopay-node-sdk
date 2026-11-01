// @sdk-owner: A7-entities
// @sdk-phase: 2
// @sdk-implemented-by: A7-entities

import { describe, expect, it } from 'bun:test';
import { isMyImoPayError, MyImoPayApiError, MyImoPayValidationError } from '@core/errors';
import type { HttpRequestOptions } from '@core/types/config';
import type { Subaccount } from '@core/types/entities';
import { MAX_REFERENCE_LENGTH, REFERENCE_PATTERN } from '@core/utils/reference';
import { SubaccountsResource } from '@node/resources/subaccounts';
import type { Responder } from './helpers/fake-http';
import { FakeHttpClient, ok } from './helpers/fake-http';

/** Builds the resource around a fake transport, returning both. */
function subaccountsWith(responder: Responder): {
  http: FakeHttpClient;
  resource: SubaccountsResource;
} {
  const http = new FakeHttpClient(responder);
  return {
    http,
    resource: new SubaccountsResource({ http, maxAmount: undefined, customer: undefined }),
  };
}

/** The single request a test expects. */
function only(calls: HttpRequestOptions[]): HttpRequestOptions {
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error('expected one request');
  return call;
}

function firstOf<T>(items: T[]): T {
  const first = items[0];
  if (first === undefined) throw new Error('expected at least one item');
  return first;
}

/** The request body as a record, for wire-shape assertions. */
function bodyOf(call: HttpRequestOptions): Record<string, unknown> {
  const body = call.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('expected the request to carry an object body');
  }
  return body as Record<string, unknown>;
}

/** Runs a call and returns what it rejected with, failing when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('expected the call to reject');
}

const SUBACCOUNT_ROW = {
  sub_account_id: 'sub_123',
  sub_code: 'IMPSUB123',
  sub_name: 'Ada Store',
  bank_code: '044',
  bank_name: 'Access Bank',
  account_number: '0123456789',
  account_name: 'ADA LOVELACE',
  currency: 'NGN',
  email_address: 'ada@example.test',
  phone_number: '+2348031234567',
  created_on: '2024-05-01T10:00:00Z',
  modified_on: '2024-05-02T11:30:00Z',
};

const VALID_INPUT = {
  name: 'Ada Store',
  bankCode: '044',
  bankName: 'Access Bank',
  accountNumber: '0123456789',
  accountName: 'ADA LOVELACE',
};

describe('SubaccountsResource', () => {
  describe('list', () => {
    it('calls the subaccount collection with the secret key', async () => {
      const { http, resource } = subaccountsWith(() => ok([SUBACCOUNT_ROW]));

      const subaccounts = await resource.list();

      const call = only(http.calls);
      expect(call.method).toBe('GET');
      expect(call.path).toBe('/vi/entities/merchant/subaccounts/accounts');
      expect(call.auth).toBe('secret');
      expect(subaccounts).toHaveLength(1);
    });

    it('treats a null data payload as an empty list', async () => {
      const { resource } = subaccountsWith(() => ok(null));

      await expect(resource.list()).resolves.toEqual([]);
    });

    it('skips rows that are not objects', async () => {
      const { resource } = subaccountsWith(() => ok([null, 'junk', SUBACCOUNT_ROW]));

      const subaccounts = await resource.list();

      expect(subaccounts).toHaveLength(1);
      expect(firstOf(subaccounts).id).toBe('sub_123');
    });
  });

  describe('get', () => {
    it('calls the single subaccount route with the secret key', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      const subaccount = await resource.get('sub_123');

      const call = only(http.calls);
      expect(call.method).toBe('GET');
      expect(call.path).toBe('/vi/entities/merchant/subaccounts/accounts/sub_123');
      expect(call.auth).toBe('secret');
      expect(subaccount.code).toBe('IMPSUB123');
    });

    it('rejects an empty id before calling the provider', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      const error = await rejection(resource.get('   '));

      expect((error as MyImoPayValidationError).field).toBe('id');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects a non-object payload as malformed', async () => {
      const { resource } = subaccountsWith(() => ok('nope'));

      const error = await rejection(resource.get('sub_123'));

      expect(isMyImoPayError(error) && error.code).toBe('MALFORMED_RESPONSE');
    });
  });

  describe('create', () => {
    it('posts the provider wire names to the add route with the secret key', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      await resource.create(VALID_INPUT);

      const call = only(http.calls);
      expect(call.method).toBe('POST');
      expect(call.path).toBe('/vi/entities/merchant/subaccounts/accounts/add');
      expect(call.auth).toBe('secret');

      const body = bodyOf(call);
      expect(body['sub_name']).toBe('Ada Store');
      expect(body['bank_code']).toBe('044');
      expect(body['bank_name']).toBe('Access Bank');
      expect(body['account_number']).toBe('0123456789');
      expect(body['account_name']).toBe('ADA LOVELACE');
      expect(body['currency']).toBe('NGN');
      expect(body).not.toHaveProperty('email_address');
      expect(body).not.toHaveProperty('phone_number');
    });

    it('generates an identifier when the caller omits one', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      await resource.create(VALID_INPUT);

      const identifier = bodyOf(only(http.calls))['identifier'];

      expect(typeof identifier).toBe('string');
      expect((identifier as string).length).toBeLessThanOrEqual(MAX_REFERENCE_LENGTH);
      expect(identifier as string).toMatch(REFERENCE_PATTERN);
    });

    it('keeps a caller-supplied identifier so a retry is idempotent', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      await resource.create({ ...VALID_INPUT, identifier: 'sub-ada-store-1' });

      expect(bodyOf(only(http.calls))['identifier']).toBe('sub-ada-store-1');
    });

    it('normalises the phone and currency, and uses email_address/phone_number', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      await resource.create({
        ...VALID_INPUT,
        currency: 'ngn',
        email: 'ada@example.test',
        phone: '08031234567',
      });

      const body = bodyOf(only(http.calls));
      expect(body['currency']).toBe('NGN');
      expect(body['email_address']).toBe('ada@example.test');
      expect(body['phone_number']).toBe('+2348031234567');
    });

    it('rejects an account number that is not a 10-digit NUBAN', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      const error = await rejection(
        resource.create({ ...VALID_INPUT, accountNumber: '012345678' }),
      );

      expect(error).toBeInstanceOf(MyImoPayValidationError);
      expect((error as MyImoPayValidationError).field).toBe('accountNumber');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects a missing bank name', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      const error = await rejection(resource.create({ ...VALID_INPUT, bankName: ' ' }));

      expect((error as MyImoPayValidationError).field).toBe('bankName');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects a phone number that is not a Nigerian mobile', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      const error = await rejection(resource.create({ ...VALID_INPUT, phone: '12345' }));

      expect((error as MyImoPayValidationError).field).toBe('phone');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects an unusable currency code', async () => {
      const { http, resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      const error = await rejection(resource.create({ ...VALID_INPUT, currency: 'naira' }));

      expect((error as MyImoPayValidationError).field).toBe('currency');
      expect(http.calls).toHaveLength(0);
    });

    it('surfaces a 409 as MyImoPayApiError code CONFLICT, swallowing nothing', async () => {
      const { resource } = subaccountsWith(() => {
        throw new MyImoPayApiError({
          code: 'CONFLICT',
          message: 'Subaccount already exists',
          status: 409,
          remark: 'Subaccount already exists',
        });
      });

      const error = await rejection(resource.create(VALID_INPUT));

      expect(error).toBeInstanceOf(MyImoPayApiError);
      expect(isMyImoPayError(error) && error.code).toBe('CONFLICT');
      expect((error as MyImoPayApiError).status).toBe(409);
    });

    it('maps the created subaccount with the wire names translated', async () => {
      const { resource } = subaccountsWith(() => ok(SUBACCOUNT_ROW));

      const subaccount: Subaccount = await resource.create(VALID_INPUT);

      expect(subaccount).toEqual({
        id: 'sub_123',
        code: 'IMPSUB123',
        name: 'Ada Store',
        bankCode: '044',
        bankName: 'Access Bank',
        accountNumber: '0123456789',
        accountName: 'ADA LOVELACE',
        currency: 'NGN',
        email: 'ada@example.test',
        phone: '+2348031234567',
        createdAt: new Date('2024-05-01T10:00:00Z'),
        updatedAt: new Date('2024-05-02T11:30:00Z'),
        raw: SUBACCOUNT_ROW,
      });
    });
  });

  it('forwards every per-call option to the transport', async () => {
    const { http, resource } = subaccountsWith(() => ok([SUBACCOUNT_ROW]));
    const controller = new AbortController();

    await resource.list({
      baseUrl: 'https://proxy.example.test',
      timeoutMs: 4321,
      headers: { 'x-trace-id': 'trace-1' },
      signal: controller.signal,
    });

    const call = only(http.calls);
    expect(call.baseUrl).toBe('https://proxy.example.test');
    expect(call.timeoutMs).toBe(4321);
    expect(call.headers).toEqual({ 'x-trace-id': 'trace-1' });
    expect(call.signal).toBe(controller.signal);
  });
});
