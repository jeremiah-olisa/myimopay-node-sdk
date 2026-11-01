// @sdk-implemented-by: A6-settlements

import { describe, expect, it } from 'bun:test';
import { MyImoPayApiError, MyImoPayValidationError } from '@myimopay/core';
import { SettlementsResource } from '@node/resources/settlements';
import { FakeHttpClient, ok, type Responder } from './helpers/fake-http';

const DIRECTS = '/vi/settlements/directs';
const SPLITS = '/vi/settlements/splits';

function setup(responder: Responder): {
  http: FakeHttpClient;
  settlements: SettlementsResource;
} {
  const http = new FakeHttpClient(responder);
  return {
    http,
    settlements: new SettlementsResource({ http, maxAmount: undefined, customer: undefined }),
  };
}

function apiError(status: number, remark: string | null): MyImoPayApiError {
  return new MyImoPayApiError({
    code: 'NOT_FOUND',
    message: remark ?? `HTTP ${status}`,
    status,
    remark,
  });
}

function thrower(error: unknown): Responder {
  return () => {
    throw error;
  };
}

const DIRECT_ROW = {
  tx_reference: 'TX-1',
  provider_reference: 'PRV-1',
  status: '2',
  currency: 'NGN',
  amount: '1500.50',
  settled_amount: '1490.10',
  fee_amount: 9,
  tax_amount: '1.40',
  admin_fee_amount: 0.5,
  charge_bearer: '2',
  settlement_order_id: 'so_1',
  settled_on: '2024-05-01T10:00:00.000Z',
};

const SPLIT_ROW = {
  tx_reference: 'SPL-1',
  settlement_order_id: 'so_9',
  status: 2,
  amount: 1000,
  settlement_amount: 970.25,
  currency: 'ngn',
  charge_bearer: 'merchant',
  allocations: [
    { subaccount_id: 'sa_1', percent_amount: '30', fixed_amount: '0', is_settlement_fixed: false },
    {
      subaccount_id: 'sa_2',
      percent_amount: '10',
      fixed_amount: '20.5',
      is_settlement_fixed: 'true',
    },
    { junk: true },
  ],
};

describe('SettlementsResource.directs', () => {
  it('calls the plain route when no window is supplied', async () => {
    const { http, settlements } = setup(() => ok([DIRECT_ROW]));

    const rows = await settlements.directs();

    expect(rows).toHaveLength(1);
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.method).toBe('GET');
    expect(http.calls[0]?.path).toBe(DIRECTS);
    expect(http.calls[0]?.auth).toBe('public');
    expect(http.calls[0]?.query).toBeUndefined();
  });

  it('calls the daterange route when both bounds are supplied', async () => {
    const { http, settlements } = setup(() => ok([DIRECT_ROW]));

    await settlements.directs({
      fromDate: '2024-05-01',
      toDate: new Date('2024-05-31T12:00:00.000Z'),
    });

    expect(http.calls[0]?.path).toBe(`${DIRECTS}/filter/daterange`);
    expect(http.calls[0]?.query).toEqual({
      from: '2024-05-01T00:00:00.000Z',
      to: '2024-05-31T12:00:00.000Z',
    });
  });

  it('rejects a window that supplies only fromDate', async () => {
    const { http, settlements } = setup(() => ok([DIRECT_ROW]));

    const error = settlements.directs({ fromDate: '2024-05-01' });

    await expect(error).rejects.toBeInstanceOf(MyImoPayValidationError);
    await expect(error).rejects.toMatchObject({ field: 'toDate' });
    expect(http.calls).toHaveLength(0);
  });

  it('rejects a window that supplies only toDate', async () => {
    const { http, settlements } = setup(() => ok([DIRECT_ROW]));

    const error = settlements.directs({ toDate: '2024-05-31' });

    await expect(error).rejects.toBeInstanceOf(MyImoPayValidationError);
    await expect(error).rejects.toMatchObject({ field: 'fromDate' });
    expect(http.calls).toHaveLength(0);
  });

  it('rejects an unparseable date', async () => {
    const { settlements } = setup(() => ok([DIRECT_ROW]));

    await expect(
      settlements.directs({ fromDate: 'not-a-date', toDate: '2024-05-31' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', field: 'fromDate' });
  });

  it('returns an empty list when the provider answers data null', async () => {
    const { settlements } = setup(() => ok(null));

    expect(await settlements.directs()).toEqual([]);
  });

  it('returns an empty list for a 404 saying no settlements were found', async () => {
    const { settlements } = setup(thrower(apiError(404, 'No settlements found.')));

    expect(await settlements.directs()).toEqual([]);
  });

  it('asks the transport to allow an empty data payload', async () => {
    const { http, settlements } = setup(() => ok(null));

    expect(await settlements.directs()).toEqual([]);
    expect(http.calls[0]?.allowEmpty).toBe(true);
  });

  it('propagates a 404 whose remark is not "nothing found"', async () => {
    const { settlements } = setup(thrower(apiError(404, 'Invalid API key supplied.')));

    const error = settlements.directs();

    await expect(error).rejects.toBeInstanceOf(MyImoPayApiError);
    await expect(error).rejects.toMatchObject({
      status: 404,
      remark: 'Invalid API key supplied.',
    });
  });

  it('propagates a 404 without a remark', async () => {
    const { settlements } = setup(thrower(apiError(404, null)));

    await expect(settlements.directs()).rejects.toBeInstanceOf(MyImoPayApiError);
  });

  it('maps a direct row', async () => {
    const { settlements } = setup(() => ok([DIRECT_ROW]));

    const [row] = await settlements.directs();

    expect(row).toMatchObject({
      reference: 'TX-1',
      providerReference: 'PRV-1',
      status: 'succeeded',
      rawStatus: 2,
      currency: 'NGN',
      amount: 1500.5,
      settledAmount: 1490.1,
      feeAmount: 9,
      taxAmount: 1.4,
      adminFeeAmount: 0.5,
      chargeBearer: 'customer',
      settlementOrderId: 'so_1',
    });
    expect(row?.settledAt?.toISOString()).toBe('2024-05-01T10:00:00.000Z');
    expect(row?.raw).toBe(DIRECT_ROW);
  });

  it('accepts alias field names and numeric strings', async () => {
    const row = {
      reference: 'ALIAS-1',
      pay_reference: 'PAY-1',
      payout_amount: '77.75',
      fee_amount: '2',
      charge_bearer: 3,
      settlement_date: '2024-06-01T00:00:00.000Z',
      status: 1,
    };
    const { settlements } = setup(() => ok([row]));

    const [mapped] = await settlements.directs();

    expect(mapped).toMatchObject({
      reference: 'ALIAS-1',
      providerReference: 'PAY-1',
      status: 'pending',
      rawStatus: 1,
      settledAmount: 77.75,
      feeAmount: 2,
      chargeBearer: 'split',
      currency: 'NGN',
      amount: 0,
      taxAmount: 0,
      adminFeeAmount: 0,
      settlementOrderId: null,
    });
    expect(mapped?.settledAt?.toISOString()).toBe('2024-06-01T00:00:00.000Z');
  });

  it('lets is_settled win over a contradictory status', async () => {
    const { settlements } = setup(() =>
      ok([{ reference: 'SETTLED-1', status: 3, is_settled: 'true' }]),
    );

    const [row] = await settlements.directs();

    expect(row?.status).toBe('succeeded');
    expect(row?.rawStatus).toBe(3);
  });

  it('skips junk rows without dropping a valid one', async () => {
    const { settlements } = setup(() => ok([null, 'nope', 42, {}, { foo: 'bar' }, [], DIRECT_ROW]));

    const rows = await settlements.directs();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.reference).toBe('TX-1');
  });

  it('rejects a successful payload that is not a list of rows', async () => {
    const { settlements } = setup(() => ok({ rows: [] }));

    await expect(settlements.directs()).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });

  it('forwards per-call request options', async () => {
    const { http, settlements } = setup(() => ok([]));
    const controller = new AbortController();
    const options = {
      signal: controller.signal,
      timeoutMs: 2500,
      headers: { 'x-test': '1' },
      baseUrl: 'https://proxy.myimopay.test',
    };

    await settlements.directs(undefined, options);

    expect(http.calls[0]).toMatchObject(options);
  });
});

describe('SettlementsResource.splits', () => {
  it('calls the plain route by default', async () => {
    const { http, settlements } = setup(() => ok([SPLIT_ROW]));

    await settlements.splits();

    expect(http.calls[0]?.path).toBe(SPLITS);
  });

  it('calls the daterange route when both bounds are supplied', async () => {
    const { http, settlements } = setup(() => ok([SPLIT_ROW]));

    await settlements.splits({ fromDate: '2024-05-01', toDate: '2024-05-31' });

    expect(http.calls[0]?.path).toBe(`${SPLITS}/filter/daterange`);
    expect(http.calls[0]?.query).toEqual({
      from: '2024-05-01T00:00:00.000Z',
      to: '2024-05-31T00:00:00.000Z',
    });
  });

  it('rejects a one-sided window', async () => {
    const { settlements } = setup(() => ok([SPLIT_ROW]));

    await expect(settlements.splits({ toDate: '2024-05-31' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      field: 'fromDate',
    });
  });

  it('returns an empty list when the provider answers data null', async () => {
    const { settlements } = setup(() => ok(null));

    expect(await settlements.splits()).toEqual([]);
  });

  it('maps a split row and its allocations', async () => {
    const { settlements } = setup(() => ok([SPLIT_ROW]));

    const [row] = await settlements.splits();

    expect(row).toMatchObject({
      reference: 'SPL-1',
      providerReference: null,
      settlementOrderId: 'so_9',
      status: 'succeeded',
      rawStatus: 2,
      currency: 'NGN',
      amount: 1000,
      settledAmount: 970.25,
    });
    expect(row?.allocations).toHaveLength(2);
    expect(row?.allocations[0]).toEqual({
      subaccountId: 'sa_1',
      percentAmount: 30,
      fixedAmount: 0,
      isFixed: false,
      raw: SPLIT_ROW.allocations[0],
    });
    expect(row?.allocations[1]).toMatchObject({
      subaccountId: 'sa_2',
      percentAmount: 10,
      fixedAmount: 20.5,
      isFixed: true,
    });
    expect(row?.raw).toBe(SPLIT_ROW);
  });

  it('maps allocation aliases and defaults missing allocations to an empty list', async () => {
    const withItems = {
      tx_reference: 'SPL-2',
      status: 2,
      order_items: [{ subaccount_id: 12, percent_amount: '5', is_fixed: 1 }],
    };
    const { settlements } = setup(() => ok([withItems, { reference: 'SPL-3' }]));

    const [first, second] = await settlements.splits();

    expect(first?.allocations[0]).toMatchObject({
      subaccountId: '12',
      percentAmount: 5,
      fixedAmount: 0,
      isFixed: true,
    });
    expect(second?.allocations).toEqual([]);
    expect(second?.amount).toBe(0);
  });
});

describe('SettlementsResource.directByReference', () => {
  it('calls the reference route and maps one row', async () => {
    const { http, settlements } = setup(() => ok(DIRECT_ROW));

    const row = await settlements.directByReference('TX/1');

    expect(http.calls[0]?.path).toBe(`${DIRECTS}/transaction/ref/TX%2F1`);
    expect(http.calls[0]?.auth).toBe('public');
    expect(row?.reference).toBe('TX-1');
  });

  it('accepts a one-row array payload', async () => {
    const { settlements } = setup(() => ok([DIRECT_ROW]));

    const row = await settlements.directByReference('TX-1');

    expect(row?.reference).toBe('TX-1');
  });

  it('returns null when the provider answers data null', async () => {
    const { settlements } = setup(() => ok(null));

    expect(await settlements.directByReference('TX-1')).toBeNull();
  });

  it('returns null for a 404 saying the settlement was not found', async () => {
    const { settlements } = setup(thrower(apiError(404, 'Settlement not found.')));

    expect(await settlements.directByReference('TX-1')).toBeNull();
  });

  it('propagates a 404 with an auth remark', async () => {
    const { settlements } = setup(thrower(apiError(404, 'Forbidden: bad key')));

    await expect(settlements.directByReference('TX-1')).rejects.toBeInstanceOf(MyImoPayApiError);
  });

  it('forwards per-call request options', async () => {
    const { http, settlements } = setup(() => ok(DIRECT_ROW));

    await settlements.directByReference('TX-1', { timeoutMs: 900, headers: { 'x-a': 'b' } });

    expect(http.calls[0]?.timeoutMs).toBe(900);
    expect(http.calls[0]?.headers).toEqual({ 'x-a': 'b' });
  });
});

describe('SettlementsResource.splitByReference', () => {
  it('calls the split reference route and maps allocations', async () => {
    const { http, settlements } = setup(() => ok(SPLIT_ROW));

    const row = await settlements.splitByReference('SPL-1');

    expect(http.calls[0]?.path).toBe(`${SPLITS}/transaction/ref/SPL-1`);
    expect(row?.allocations).toHaveLength(2);
  });

  it('returns null for a 404 saying no settlements were found', async () => {
    const { settlements } = setup(thrower(apiError(404, 'No settlements found.')));

    expect(await settlements.splitByReference('SPL-1')).toBeNull();
  });

  it('propagates a 404 with an auth remark', async () => {
    const { settlements } = setup(thrower(apiError(404, 'Unauthorized')));

    await expect(settlements.splitByReference('SPL-1')).rejects.toBeInstanceOf(MyImoPayApiError);
  });
});

describe('SettlementsResource.splitByOrder', () => {
  it('calls the order route and returns every row', async () => {
    const { http, settlements } = setup(() => ok([SPLIT_ROW]));

    const rows = await settlements.splitByOrder('so_9');

    expect(http.calls[0]?.path).toBe(`${SPLITS}/order/so_9`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.settlementOrderId).toBe('so_9');
  });

  it('rejects an empty order id before any request', async () => {
    const { http, settlements } = setup(() => ok([SPLIT_ROW]));

    await expect(settlements.splitByOrder('  ')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      field: 'settlementOrderId',
    });
    expect(http.calls).toHaveLength(0);
  });

  it('returns an empty list when the provider answers data null', async () => {
    const { settlements } = setup(() => ok(null));

    expect(await settlements.splitByOrder('so_9')).toEqual([]);
  });
});
