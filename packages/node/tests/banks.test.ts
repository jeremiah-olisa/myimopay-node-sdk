// @sdk-owner: A7-entities
// @sdk-phase: 2
// @sdk-implemented-by: A7-entities

import { describe, expect, it } from 'bun:test';
import { isMyImoPayError, MyImoPayValidationError } from '@core/errors';
import type { HttpRequestOptions } from '@core/types/config';
import type { Bank, BankAccount } from '@core/types/entities';
import { BanksResource } from '@node/resources/banks';
import type { Responder } from './helpers/fake-http';
import { FakeHttpClient, ok } from './helpers/fake-http';

/** Builds the resource around a fake transport, returning both. */
function banksWith(responder: Responder): { http: FakeHttpClient; resource: BanksResource } {
  const http = new FakeHttpClient(responder);
  return { http, resource: new BanksResource({ http, maxAmount: undefined, customer: undefined }) };
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

/** Runs a call and returns what it rejected with, failing when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('expected the call to reject');
}

const BANK_ROW = {
  bank_code: '044',
  bank_name: 'Access Bank',
  alpha_two: 'NG',
  swift_code: 'ABNGNGLA',
  bic: null,
  bank_type: 'commercial',
  routing_number: '000044',
  identifier: 'bank_044',
};

const ACCOUNT_ROW = {
  bank_code: '044',
  account_number: '0123456789',
  account_name: 'ADA LOVELACE',
  branch_code: '000',
  identifier: 'acct_1',
};

describe('BanksResource', () => {
  describe('list', () => {
    it('calls the country directory with the public key', async () => {
      const { http, resource } = banksWith(() => ok([BANK_ROW]));

      const banks = await resource.list('NG');

      const call = only(http.calls);
      expect(call.method).toBe('GET');
      expect(call.path).toBe('/vi/entities/banks/NG');
      expect(call.auth).toBe('public');
      expect(banks).toHaveLength(1);
    });

    it('normalises and upper-cases the country code', async () => {
      const { http, resource } = banksWith(() => ok([]));

      await resource.list(' ng ');

      expect(only(http.calls).path).toBe('/vi/entities/banks/NG');
    });

    it('rejects an unusable country code before calling the provider', async () => {
      const { http, resource } = banksWith(() => ok([]));

      const error = await rejection(resource.list('NGA'));

      expect(error).toBeInstanceOf(MyImoPayValidationError);
      expect(isMyImoPayError(error) && error.code).toBe('VALIDATION_ERROR');
      expect((error as MyImoPayValidationError).field).toBe('countryCode');
      expect(http.calls).toHaveLength(0);
    });

    it('treats a null data payload as an empty list', async () => {
      const { resource } = banksWith(() => ok(null));

      await expect(resource.list('NG')).resolves.toEqual([]);
    });

    it('maps every modelled field and keeps the raw row', async () => {
      const { resource } = banksWith(() => ok([BANK_ROW]));

      const bank: Bank = firstOf(await resource.list('NG'));

      expect(bank).toEqual({
        code: '044',
        name: 'Access Bank',
        countryCode: 'NG',
        swiftCode: 'ABNGNGLA',
        bankType: 'commercial',
        routingNumber: '000044',
        raw: BANK_ROW,
      });
    });

    it('falls back to bic when swift_code is absent', async () => {
      const { resource } = banksWith(() =>
        ok([{ bank_code: '011', bank_name: 'First Bank', bic: 'FBNINGLA' }]),
      );

      const bank = firstOf(await resource.list('NG'));

      expect(bank.swiftCode).toBe('FBNINGLA');
      expect(bank.bankType).toBeNull();
    });

    it('skips rows that are not objects', async () => {
      const { resource } = banksWith(() => ok([null, 'junk', 7, BANK_ROW]));

      const banks = await resource.list('NG');

      expect(banks).toHaveLength(1);
      expect(firstOf(banks).code).toBe('044');
    });
  });

  describe('resolve', () => {
    it('calls the resolve route with the public key', async () => {
      const { http, resource } = banksWith(() => ok(ACCOUNT_ROW));

      await resource.resolve({ bankCode: '044', accountNumber: '0123456789' });

      const call = only(http.calls);
      expect(call.method).toBe('GET');
      expect(call.path).toBe('/vi/entities/banks/account/044/0123456789/resolve');
      expect(call.auth).toBe('public');
    });

    it('maps the resolved account and keeps the raw payload', async () => {
      const { resource } = banksWith(() => ok(ACCOUNT_ROW));

      const account: BankAccount = await resource.resolve({
        bankCode: '044',
        accountNumber: '0123456789',
      });

      expect(account).toEqual({
        bankCode: '044',
        accountNumber: '0123456789',
        accountName: 'ADA LOVELACE',
        branchCode: '000',
        raw: ACCOUNT_ROW,
      });
    });

    it('rejects an empty bank code', async () => {
      const { http, resource } = banksWith(() => ok(ACCOUNT_ROW));

      const error = await rejection(
        resource.resolve({ bankCode: '  ', accountNumber: '0123456789' }),
      );

      expect((error as MyImoPayValidationError).field).toBe('bankCode');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects an account number that would reshape the URL', async () => {
      const { http, resource } = banksWith(() => ok(ACCOUNT_ROW));

      const error = await rejection(
        resource.resolve({ bankCode: '044', accountNumber: '../0123456789' }),
      );

      expect(error).toBeInstanceOf(MyImoPayValidationError);
      expect((error as MyImoPayValidationError).field).toBe('accountNumber');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects a non-object payload as malformed', async () => {
      const { resource } = banksWith(() => ok(['not', 'an', 'account']));

      const error = await rejection(
        resource.resolve({ bankCode: '044', accountNumber: '0123456789' }),
      );

      expect(isMyImoPayError(error) && error.code).toBe('MALFORMED_RESPONSE');
    });
  });

  it('forwards every per-call option to the transport', async () => {
    const { http, resource } = banksWith(() => ok([BANK_ROW]));
    const controller = new AbortController();

    await resource.list('NG', {
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

  it('leaves options absent so the client defaults apply', async () => {
    const { http, resource } = banksWith(() => ok([]));

    await resource.list('NG');

    const call = only(http.calls);
    expect(call.baseUrl).toBeUndefined();
    expect(call.timeoutMs).toBeUndefined();
    expect(call.signal).toBeUndefined();
  });
});
