// @sdk-owner: A5-transactions
// @sdk-phase: 1
// @sdk-implemented-by: A5-transactions

import { describe, expect, it } from 'bun:test';
import { MyImoPayApiError, MyImoPayValidationError } from '@myimopay/core';
import type { ResourceContext } from '@node/context';
import { TransactionsResource } from '@node/resources/transactions';
import { FakeHttpClient, ok, type Responder } from './helpers/fake-http';

/** A complete provider row; individual tests override the field under test. */
const wireRow = {
  identifier: '0191f2',
  tx_reference: 'TX-1001',
  provider_reference: 'PROV-9',
  pay_reference: 'PAY-9',
  status: '2',
  is_settled: false,
  is_split: true,
  charge_bearer: '1',
  initial_amount: '1500.50',
  charged_amount: 1500.5,
  paid_amount: '1500.5',
  payout_amount: '1486.37',
  fee_amount: '12.5',
  tax_amount: '0.63',
  admin_fee_amount: '1',
  currency: 'NGN',
  customer_name: '  Ada Lovelace  ',
  customer_email: 'ada@example.test',
  customer_phone: '08030000000',
  settlement_order_id: 'SO-1',
  callback_url: 'https://merchant.test/cb',
  payment_link: 'https://pay.test/abc',
  expiration_time: '2024-01-02T03:04:05.000Z',
  created_on: '2024-01-01T00:00:00.000Z',
  modified_on: '2024-01-03T00:00:00.000Z',
};

function resourceOf(responder: Responder): {
  resource: TransactionsResource;
  http: FakeHttpClient;
} {
  const http = new FakeHttpClient(responder);
  const context: ResourceContext = { http, maxAmount: undefined, customer: undefined };
  return { resource: new TransactionsResource(context), http };
}

function notFound(): never {
  throw new MyImoPayApiError({
    code: 'NOT_FOUND',
    message: 'Transaction not found.',
    status: 404,
  });
}

function serverError(): never {
  throw new MyImoPayApiError({
    code: 'PROVIDER_ERROR',
    message: 'The provider is unhappy.',
    status: 500,
  });
}

describe('TransactionsResource.list', () => {
  it('calls the unpaginated route and maps every row', async () => {
    const { resource, http } = resourceOf(() =>
      ok([wireRow, { ...wireRow, tx_reference: 'TX-2' }]),
    );

    const transactions = await resource.list();

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.method).toBe('GET');
    expect(http.lastPath).toBe('/vi/transactions');
    expect(http.lastQuery).toBeUndefined();
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.reference).toBe('TX-1001');
    expect(transactions[1]?.reference).toBe('TX-2');
  });

  it('returns an empty list for a null payload', async () => {
    const { resource } = resourceOf(() => ok(null));

    expect(await resource.list()).toEqual([]);
  });

  it('skips rows that are not objects instead of throwing', async () => {
    const { resource } = resourceOf(() =>
      ok([wireRow, 'junk', 42, null, ['nested'], { ...wireRow, tx_reference: 'TX-2' }]),
    );

    const transactions = await resource.list();

    expect(transactions.map((transaction) => transaction.reference)).toEqual(['TX-1001', 'TX-2']);
  });
});

describe('TransactionsResource.filter', () => {
  it('maps every query parameter onto the wire', async () => {
    const { resource, http } = resourceOf(() => ok({ items: [], total: 0 }));

    await resource.filter({
      page: 2,
      pageSize: 25,
      status: 'succeeded',
      fromDate: new Date('2024-01-01T00:00:00.000Z'),
      toDate: '2024-01-31',
      search: 'ada',
      sortBy: 'created_on',
      sortOrder: 'desc',
    });

    expect(http.lastPath).toBe('/vi/transactions/filter');
    expect(http.calls[0]?.method).toBe('GET');
    expect(http.lastQuery).toEqual({
      page: 2,
      pageSize: 25,
      status: 2,
      fromDate: '2024-01-01T00:00:00.000Z',
      toDate: '2024-01-31',
      search: 'ada',
      sortBy: 'created_on',
      sortOrder: 'desc',
    });
  });

  it('passes a numeric status through untouched', async () => {
    const { resource, http } = resourceOf(() => ok({ items: [] }));

    await resource.filter({ status: 3 });

    expect(http.lastQuery).toEqual({ status: 3 });
  });

  it('sends a named status as the provider integer', async () => {
    const { resource, http } = resourceOf(() => ok({ items: [] }));

    await resource.filter({ status: 'expired' });

    expect(http.lastQuery).toEqual({ status: 4 });
  });

  it('omits the whole query for an empty filter', async () => {
    const { resource, http } = resourceOf(() => ok({ items: [] }));

    await resource.filter();

    expect(http.lastQuery).toBeUndefined();
  });

  it('rejects a Date that cannot be serialised', async () => {
    const { resource } = resourceOf(() => ok({ items: [] }));

    await expect(resource.filter({ fromDate: new Date('nope') })).rejects.toBeInstanceOf(
      MyImoPayValidationError,
    );
  });

  describe('paging envelope', () => {
    it('reads items/total/pageNumber/page_size', async () => {
      const { resource } = resourceOf(() =>
        ok({ items: [wireRow], total: 12, pageNumber: '2', page_size: 5 }),
      );

      const page = await resource.filter();

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(12);
      expect(page.page).toBe(2);
      expect(page.pageSize).toBe(5);
    });

    it('reads records/totalCount with paging fields absent', async () => {
      const { resource } = resourceOf(() => ok({ records: [wireRow], totalCount: '7' }));

      const page = await resource.filter();

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(7);
      expect(page.page).toBeNull();
      expect(page.pageSize).toBeNull();
    });

    it('reads rows from a data property', async () => {
      const { resource } = resourceOf(() => ok({ data: [wireRow, wireRow] }));

      const page = await resource.filter();

      expect(page.items).toHaveLength(2);
      expect(page.total).toBeNull();
      expect(page.page).toBeNull();
      expect(page.pageSize).toBeNull();
    });

    it('accepts a bare array', async () => {
      const { resource } = resourceOf(() => ok([wireRow]));

      const page = await resource.filter();

      expect(page.items).toHaveLength(1);
      expect(page.total).toBeNull();
      expect(page.page).toBeNull();
      expect(page.pageSize).toBeNull();
      expect(page.raw).toEqual([wireRow]);
    });

    it('returns an empty page for a missing body', async () => {
      const { resource } = resourceOf(() => ok(null));

      const page = await resource.filter();

      expect(page).toEqual({ items: [], total: null, page: null, pageSize: null, raw: null });
    });

    it('returns an empty page for an object with no rows and no paging', async () => {
      const { resource } = resourceOf(() => ok({}));

      const page = await resource.filter();

      expect(page.items).toEqual([]);
      expect(page.total).toBeNull();
      expect(page.page).toBeNull();
      expect(page.pageSize).toBeNull();
    });
  });
});

describe('TransactionsResource transaction mapping', () => {
  it('normalises numeric strings, trims strings and keeps raw untouched', async () => {
    const { resource } = resourceOf(() => ok([wireRow]));

    const [transaction] = await resource.list();

    expect(transaction?.id).toBe('0191f2');
    expect(transaction?.reference).toBe('TX-1001');
    expect(transaction?.providerReference).toBe('PROV-9');
    expect(transaction?.payReference).toBe('PAY-9');
    expect(transaction?.currency).toBe('NGN');
    expect(transaction?.amountInitial).toBe(1500.5);
    expect(transaction?.amountCharged).toBe(1500.5);
    expect(transaction?.amountPaid).toBe(1500.5);
    expect(transaction?.amountPayout).toBe(1486.37);
    expect(transaction?.feeAmount).toBe(12.5);
    expect(transaction?.taxAmount).toBe(0.63);
    expect(transaction?.adminFeeAmount).toBe(1);
    expect(transaction?.customerName).toBe('Ada Lovelace');
    expect(transaction?.isSplit).toBe(true);
    expect(transaction?.chargeBearer).toBe('merchant');
    expect(transaction?.rawStatus).toBe(2);
    expect(transaction?.status).toBe('succeeded');
    expect(transaction?.isSettled).toBe(false);
    expect(transaction?.raw).toBe(wireRow);
  });

  it('lets is_settled win over a contradictory status', async () => {
    const { resource } = resourceOf(() => ok([{ ...wireRow, status: 3, is_settled: true }]));

    const [transaction] = await resource.list();

    expect(transaction?.rawStatus).toBe(3);
    expect(transaction?.isSettled).toBe(true);
    expect(transaction?.status).toBe('succeeded');
  });

  it('treats a non-boolean is_settled as false', async () => {
    const { resource } = resourceOf(() => ok([{ ...wireRow, is_settled: 'true' }]));

    const [transaction] = await resource.list();

    expect(transaction?.isSettled).toBe(false);
  });

  it('maps empty and whitespace-only strings to null', async () => {
    const { resource } = resourceOf(() =>
      ok([
        {
          ...wireRow,
          identifier: '',
          tx_reference: '   ',
          provider_reference: '',
          pay_reference: '',
          settlement_order_id: '',
          callback_url: ' ',
          customer_name: '',
          customer_email: ' ',
          customer_phone: '',
          payment_link: '',
        },
      ]),
    );

    const [transaction] = await resource.list();

    expect(transaction?.id).toBeNull();
    expect(transaction?.reference).toBeNull();
    expect(transaction?.providerReference).toBeNull();
    expect(transaction?.payReference).toBeNull();
    expect(transaction?.settlementOrderId).toBeNull();
    expect(transaction?.callbackUrl).toBeNull();
    expect(transaction?.customerName).toBeNull();
    expect(transaction?.customerEmail).toBeNull();
    expect(transaction?.customerPhone).toBeNull();
    expect(transaction?.paymentLink).toBeNull();
  });

  it('parses dates defensively', async () => {
    const { resource } = resourceOf(() =>
      ok([
        {
          ...wireRow,
          expiration_time: 'not-a-date',
          created_on: '   ',
          modified_on: '2024-01-03T00:00:00.000Z',
        },
      ]),
    );

    const [transaction] = await resource.list();

    expect(transaction?.expiresAt).toBeNull();
    expect(transaction?.createdAt).toBeNull();
    expect(transaction?.updatedAt).toEqual(new Date('2024-01-03T00:00:00.000Z'));
  });

  it('falls back to zero for unusable amounts without dropping the row', async () => {
    const { resource } = resourceOf(() =>
      ok([{ ...wireRow, initial_amount: 'N/A', paid_amount: '', fee_amount: null }]),
    );

    const [transaction] = await resource.list();

    expect(transaction?.amountInitial).toBe(0);
    expect(transaction?.amountPaid).toBe(0);
    expect(transaction?.feeAmount).toBe(0);
    expect(transaction?.reference).toBe('TX-1001');
  });

  it('maps an unknown status to unknown with a null rawStatus', async () => {
    const { resource } = resourceOf(() => ok([{ ...wireRow, status: 'weird', charge_bearer: 99 }]));

    const [transaction] = await resource.list();

    expect(transaction?.status).toBe('unknown');
    expect(transaction?.rawStatus).toBeNull();
    expect(transaction?.chargeBearer).toBeNull();
  });
});

describe('TransactionsResource.findById / findByReference', () => {
  it('calls the reference route and maps the transaction', async () => {
    const { resource, http } = resourceOf(() => ok(wireRow));

    const transaction = await resource.findByReference('TX-1001');

    expect(http.lastPath).toBe('/vi/transactions/reference/TX-1001');
    expect(http.calls[0]?.method).toBe('GET');
    expect(transaction?.id).toBe('0191f2');
  });

  it('calls the identity route and maps the transaction', async () => {
    const { resource, http } = resourceOf(() => ok(wireRow));

    const transaction = await resource.findById('0191f2');

    expect(http.lastPath).toBe('/vi/transactions/identity/0191f2');
    expect(transaction?.reference).toBe('TX-1001');
  });

  it('resolves a 404 to null on both lookups', async () => {
    const { resource } = resourceOf(notFound);

    expect(await resource.findByReference('missing')).toBeNull();
    expect(await resource.findById('missing')).toBeNull();
  });

  it('resolves a null payload to null', async () => {
    const { resource } = resourceOf(() => ok(null));

    expect(await resource.findById('0191f2')).toBeNull();
  });

  it('propagates every other failure', async () => {
    const { resource } = resourceOf(serverError);

    const referenceFailure = resource.findByReference('TX-1001');
    await expect(referenceFailure).rejects.toBeInstanceOf(MyImoPayApiError);
    await expect(resource.findById('0191f2')).rejects.toMatchObject({ status: 500 });
  });
});

describe('TransactionsResource.summary / statusCounts / analytics', () => {
  it('sends both bounds when the range is complete', async () => {
    const { resource, http } = resourceOf(() => ok({ volume: 1000 }));

    const summary = await resource.summary({
      fromDate: new Date('2024-01-01T00:00:00.000Z'),
      toDate: new Date('2024-01-31T23:59:59.000Z'),
    });

    expect(http.lastPath).toBe('/vi/transactions/summary');
    expect(http.lastQuery).toEqual({
      fromDate: '2024-01-01T00:00:00.000Z',
      toDate: '2024-01-31T23:59:59.000Z',
    });
    expect(summary).toEqual({ volume: 1000 });
  });

  it('omits a one-sided range and an absent range', async () => {
    const { resource, http } = resourceOf(() => ok({ volume: 0 }));

    await resource.summary({ fromDate: '2024-01-01' });
    expect(http.lastQuery).toBeUndefined();

    await resource.summary();
    expect(http.lastQuery).toBeUndefined();
  });

  it('returns the provider record untouched', async () => {
    const payload = { counts: { succeeded: 3 }, nested: { any: ['shape'] } };
    const { resource, http } = resourceOf(() => ok(payload));

    const counts = await resource.statusCounts();

    expect(http.lastPath).toBe('/vi/transactions/status-counts');
    expect(http.lastQuery).toBeUndefined();
    expect(counts).toBe(payload);
  });

  it('sends days only when it is a positive integer', async () => {
    const { resource, http } = resourceOf(() => ok({ points: [] }));

    await resource.analytics(7);
    expect(http.lastPath).toBe('/vi/transactions/analytics');
    expect(http.lastQuery).toEqual({ days: 7 });

    await resource.analytics();
    expect(http.lastQuery).toBeUndefined();

    await resource.analytics(0);
    expect(http.lastQuery).toBeUndefined();

    await resource.analytics(-3);
    expect(http.lastQuery).toBeUndefined();

    await resource.analytics(2.5);
    expect(http.lastQuery).toBeUndefined();
  });

  it('returns an empty record when the payload is not an object', async () => {
    const { resource } = resourceOf(() => ok(null));

    expect(await resource.summary()).toEqual({});
  });
});

describe('TransactionsResource request options', () => {
  it('forwards baseUrl, headers, timeout and signal to the transport', async () => {
    const { resource, http } = resourceOf(() => ok([]));
    const controller = new AbortController();

    await resource.list({
      baseUrl: 'https://proxy.example.test',
      headers: { 'x-trace-id': 'abc' },
      timeoutMs: 50,
      signal: controller.signal,
    });

    const call = http.calls[0];
    expect(call?.baseUrl).toBe('https://proxy.example.test');
    expect(call?.headers).toEqual({ 'x-trace-id': 'abc' });
    expect(call?.timeoutMs).toBe(50);
    expect(call?.signal).toBe(controller.signal);
    expect(call?.auth).toBe('public');
  });
});
