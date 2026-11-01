// @sdk-owner: A7-entities
// @sdk-phase: 2
// @sdk-implemented-by: A7-entities

import { describe, expect, it } from 'bun:test';
import { isMyImoPayError, MyImoPayValidationError } from '@core/errors';
import type { HttpRequestOptions } from '@core/types/config';
import type { SettlementOrder } from '@core/types/entities';
import { SettlementOrdersResource } from '@node/resources/settlement-orders';
import type { Responder } from './helpers/fake-http';
import { FakeHttpClient, ok } from './helpers/fake-http';

/** Builds the resource around a fake transport, returning both. */
function ordersWith(responder: Responder): {
  http: FakeHttpClient;
  resource: SettlementOrdersResource;
} {
  const http = new FakeHttpClient(responder);
  return {
    http,
    resource: new SettlementOrdersResource({ http, maxAmount: undefined, customer: undefined }),
  };
}

/** The single request a test expects. */
function only(calls: HttpRequestOptions[]): HttpRequestOptions {
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error('expected one request');
  return call;
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

const ORDER_UUID = '3f2a9c1e-0b6d-4f5a-8a2e-1c3d5e7f9a0b';

const ORDER_ROW = {
  settlement_order_id: ORDER_UUID,
  settlement_name: 'Split 55/30',
  settle_merchant: true,
  override_charge_bearer: 1,
  charge_bearer: 2,
  order_items: [
    {
      subaccount_id: 'sub_1',
      percent_amount: '55.5',
      fixed_amount: '0',
      is_settlement_fixed: 0,
    },
    { subaccount_id: 'sub_2', percent_amount: 30, fixed_amount: '1000', is_settlement_fixed: '1' },
  ],
  is_mixed_settlement: 'true',
  identifier: 'order-1',
  created_on: '2024-05-01 10:00:00',
  modified_on: 1_714_600_000_000,
};

const SPLIT_INPUT = {
  name: 'Split 55/30',
  items: [
    { subaccountId: 'sub_1', percentage: 55.5 },
    { subaccountId: 'sub_2', percentage: 30 },
  ],
};

describe('SettlementOrdersResource', () => {
  describe('list', () => {
    it('calls the settlement order collection with the secret key', async () => {
      const { http, resource } = ordersWith(() => ok([ORDER_ROW]));

      const orders = await resource.list();

      const call = only(http.calls);
      expect(call.method).toBe('GET');
      expect(call.path).toBe('/vi/entities/merchant/settlements/orders');
      expect(call.auth).toBe('secret');
      expect(orders).toHaveLength(1);
    });

    it('treats a null data payload as an empty list', async () => {
      const { resource } = ordersWith(() => ok(null));

      await expect(resource.list()).resolves.toEqual([]);
    });

    it('skips rows that are not objects', async () => {
      const { resource } = ordersWith(() => ok([null, 42, ORDER_ROW]));

      const orders = await resource.list();

      expect(orders).toHaveLength(1);
      expect(orders[0]?.name).toBe('Split 55/30');
    });
  });

  describe('get', () => {
    it('calls the single order route with the secret key', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const order = await resource.get(ORDER_UUID);

      const call = only(http.calls);
      expect(call.method).toBe('GET');
      expect(call.path).toBe(`/vi/entities/merchant/settlements/orders/${ORDER_UUID}`);
      expect(call.auth).toBe('secret');
      expect(order.id).toBe(ORDER_UUID);
    });

    it('rejects an empty id before calling the provider', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(resource.get(''));

      expect((error as MyImoPayValidationError).field).toBe('id');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects a non-object payload as malformed', async () => {
      const { resource } = ordersWith(() => ok(7));

      const error = await rejection(resource.get(ORDER_UUID));

      expect(isMyImoPayError(error) && error.code).toBe('MALFORMED_RESPONSE');
    });
  });

  describe('create', () => {
    it('posts the provider payload with integer charge_bearer 2 by default', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      await resource.create(SPLIT_INPUT);

      const call = only(http.calls);
      expect(call.method).toBe('POST');
      expect(call.path).toBe('/vi/entities/merchant/settlements/orders/add');
      expect(call.auth).toBe('secret');

      const body = bodyOf(call);
      expect(body['settlement_name']).toBe('Split 55/30');
      expect(body['charge_bearer']).toBe(2);
      expect(body['order_items']).toEqual([
        {
          subaccount_id: 'sub_1',
          percent_amount: 55.5,
          fixed_amount: 0,
          is_settlement_fixed: false,
        },
        { subaccount_id: 'sub_2', percent_amount: 30, fixed_amount: 0, is_settlement_fixed: false },
      ]);
      expect(body).not.toHaveProperty('override_charge_bearer');
      expect(body).not.toHaveProperty('identifier');
    });

    it('maps merchant to 1 and split to 3, and forwards the override flag', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      await resource.create({
        ...SPLIT_INPUT,
        chargeBearer: 'merchant',
        overrideChargeBearer: true,
        identifier: 'order-1',
      });

      let body = bodyOf(only(http.calls));
      expect(body['charge_bearer']).toBe(1);
      expect(body['override_charge_bearer']).toBe(true);
      expect(body['identifier']).toBe('order-1');

      const split = ordersWith(() => ok(ORDER_ROW));
      await split.resource.create({ ...SPLIT_INPUT, chargeBearer: 'split' });

      body = bodyOf(only(split.http.calls));
      expect(body['charge_bearer']).toBe(3);
      expect(body['override_charge_bearer']).toBeUndefined();
    });

    it('sends fixed legs with is_settlement_fixed', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      await resource.create({
        name: 'Fixed leg',
        items: [
          { subaccountId: 'sub_1', percentage: 40 },
          { subaccountId: 'sub_2', fixedAmount: 500, isFixed: true },
        ],
      });

      const orderItems = bodyOf(only(http.calls))['order_items'] as unknown[];
      expect(orderItems[1]).toEqual({
        subaccount_id: 'sub_2',
        percent_amount: 0,
        fixed_amount: 500,
        is_settlement_fixed: true,
      });
    });

    it('rejects a split of 100% or more locally, before any request', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(
        resource.create({
          name: 'Too much',
          items: [
            { subaccountId: 'sub_1', percentage: 60 },
            { subaccountId: 'sub_2', percentage: 40 },
          ],
        }),
      );

      expect(error).toBeInstanceOf(MyImoPayValidationError);
      expect((error as MyImoPayValidationError).field).toBe('items');
      expect((error as Error).message).toMatch(/merchant keeps the remainder/);
      expect((error as Error).message).toMatch(/strictly less than 100%/);
      expect(http.calls).toHaveLength(0);
    });

    it('rejects a repeated subaccount id', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(
        resource.create({
          name: 'Duplicate',
          items: [
            { subaccountId: 'sub_1', percentage: 10 },
            { subaccountId: 'sub_1', percentage: 20 },
          ],
        }),
      );

      expect((error as MyImoPayValidationError).field).toBe('items');
      expect((error as Error).message).toMatch(/only once per settlement order/);
      expect(http.calls).toHaveLength(0);
    });

    it('rejects an order without items', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(resource.create({ name: 'Empty', items: [] }));

      expect((error as MyImoPayValidationError).field).toBe('items');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects an empty identifier when one is supplied', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(resource.create({ ...SPLIT_INPUT, identifier: '  ' }));

      expect((error as MyImoPayValidationError).field).toBe('identifier');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects an empty settlement name', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(resource.create({ name: '   ', items: SPLIT_INPUT.items }));

      expect((error as MyImoPayValidationError).field).toBe('name');
      expect(http.calls).toHaveLength(0);
    });

    it('rejects a fixed amount that is not a usable amount', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(
        resource.create({
          name: 'Bad fixed',
          items: [{ subaccountId: 'sub_1', fixedAmount: 0, isFixed: true }],
        }),
      );

      expect((error as MyImoPayValidationError).field).toBe('items[0].fixedAmount');
      expect(http.calls).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('puts the id as identifier and repeats a UUID as settlement_order_id', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      await resource.update(ORDER_UUID, SPLIT_INPUT);

      const call = only(http.calls);
      expect(call.method).toBe('PUT');
      expect(call.path).toBe('/vi/entities/merchant/settlements/orders/edit');
      expect(call.auth).toBe('secret');

      const body = bodyOf(call);
      expect(body['identifier']).toBe(ORDER_UUID);
      expect(body['settlement_order_id']).toBe(ORDER_UUID);
      expect(body['settlement_name']).toBe('Split 55/30');
    });

    it('omits settlement_order_id when the id is not a UUID', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      await resource.update('order-1', SPLIT_INPUT);

      const body = bodyOf(only(http.calls));
      expect(body['identifier']).toBe('order-1');
      expect(body).not.toHaveProperty('settlement_order_id');
    });

    it('rejects an empty id', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(resource.update('  ', SPLIT_INPUT));

      expect((error as MyImoPayValidationError).field).toBe('id');
      expect(http.calls).toHaveLength(0);
    });

    it('applies the same percentage rule as create', async () => {
      const { http, resource } = ordersWith(() => ok(ORDER_ROW));

      const error = await rejection(
        resource.update('order-1', {
          name: 'Too much',
          items: [{ subaccountId: 'sub_1', percentage: 100 }],
        }),
      );

      expect((error as MyImoPayValidationError).field).toBe('items');
      expect(http.calls).toHaveLength(0);
    });
  });

  describe('mapping', () => {
    it('normalises the order and its legs, tolerating numeric strings', async () => {
      const { resource } = ordersWith(() => ok(ORDER_ROW));

      const order: SettlementOrder = await resource.get(ORDER_UUID);

      expect(order.id).toBe(ORDER_UUID);
      expect(order.name).toBe('Split 55/30');
      expect(order.chargeBearer).toBe('customer');
      expect(order.overrideChargeBearer).toBe(true);
      expect(order.isMixed).toBe(true);
      expect(order.createdAt).toEqual(new Date('2024-05-01T10:00:00'));
      expect(order.updatedAt).toEqual(new Date(1_714_600_000_000));
      expect(order.raw).toBe(ORDER_ROW);
      expect(order.items).toHaveLength(2);
      expect(order.items[0]).toEqual({
        subaccountId: 'sub_1',
        percentage: 55.5,
        fixedAmount: 0,
        isFixed: false,
        raw: ORDER_ROW.order_items[0],
      });
      expect(order.items[1]?.fixedAmount).toBe(1000);
      expect(order.items[1]?.isFixed).toBe(true);
    });

    it('skips junk legs instead of failing the whole order', async () => {
      const { resource } = ordersWith(() =>
        ok({
          settlement_order_id: 'order-9',
          settlement_name: 'Junk legs',
          order_items: [null, 'junk', { subaccount_id: 'sub_1', percent_amount: '10' }],
        }),
      );

      const order = await resource.get('order-9');

      expect(order.items).toHaveLength(1);
      expect(order.items[0]?.percentage).toBe(10);
      expect(order.chargeBearer).toBeNull();
      expect(order.overrideChargeBearer).toBe(false);
      expect(order.isMixed).toBe(false);
      expect(order.createdAt).toBeNull();
    });
  });

  it('forwards every per-call option to the transport', async () => {
    const { http, resource } = ordersWith(() => ok([ORDER_ROW]));
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
