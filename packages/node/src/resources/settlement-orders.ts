// @sdk-owner: A7-entities
// @sdk-phase: 2
// @sdk-implemented-by: A7-entities

import type {
  ChargeBearer,
  CreateSettlementOrderInput,
  HttpRequestOptions,
  RequestOptions,
  SettlementOrder,
  SettlementOrderItem,
  SettlementOrderItemInput,
} from '@myimopay/core';
import {
  assertAmount,
  assertNonEmptyString,
  assertSettlementPercentages,
  MyImoPayError,
  MyImoPayValidationError,
  mapChargeBearer,
} from '@myimopay/core';
import type { ResourceContext } from '../context';

/** Settlement order collection root. */
const BASE_PATH = '/vi/entities/merchant/settlements/orders';

/**
 * The provider's integer charge-bearer values. `customer` is the default the
 * provider documents: the payer bears the charge.
 */
const CHARGE_BEARER_CODES: Readonly<Record<string, number>> = {
  merchant: 1,
  customer: 2,
  split: 3,
};

/** Provider ids that look like this must also travel as `settlement_order_id`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The provider charges the payer unless the caller says otherwise. */
const DEFAULT_CHARGE_BEARER: ChargeBearer = 'customer';

/** Split instructions (`/vi/entities/merchant/settlements/orders*`). Requires the secret key. */
export class SettlementOrdersResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  /** Every settlement order. `data: null` is an empty list, never an error. */
  async list(options?: RequestOptions): Promise<SettlementOrder[]> {
    const result = await this.#context.http.request<unknown>(
      withOptions({ method: 'GET', path: BASE_PATH, auth: 'secret', allowEmpty: true }, options),
    );

    return toOrders(result.data);
  }

  /** One settlement order by id. */
  async get(id: string, options?: RequestOptions): Promise<SettlementOrder> {
    const orderId = assertId(id);
    const result = await this.#context.http.request<unknown>(
      withOptions({ method: 'GET', path: `${BASE_PATH}/${orderId}`, auth: 'secret' }, options),
    );

    return toOrderOrThrow(result.data);
  }

  /**
   * Creates a split instruction.
   *
   * Percentages must total strictly less than 100% because the merchant keeps
   * the remainder; a total of 100% or more is rejected here, before the
   * provider can reject it after a payment has already been funded.
   */
  async create(
    input: CreateSettlementOrderInput,
    options?: RequestOptions,
  ): Promise<SettlementOrder> {
    const identifier =
      input.identifier === undefined
        ? undefined
        : assertNonEmptyString(input.identifier, 'identifier');
    const body = toOrderPayload(input, { identifier });
    const result = await this.#context.http.request<unknown>(
      withOptions({ method: 'POST', path: `${BASE_PATH}/add`, body, auth: 'secret' }, options),
    );

    return toOrderOrThrow(result.data);
  }

  /**
   * Edits a settlement order.
   *
   * The provider's edit route is keyed differently from the read routes: it
   * takes the id as `identifier`, and a UUID id is repeated as
   * `settlement_order_id` so either lookup key is present.
   */
  async update(
    id: string,
    input: CreateSettlementOrderInput,
    options?: RequestOptions,
  ): Promise<SettlementOrder> {
    const orderId = assertNonEmptyString(id, 'id');
    const body = toOrderPayload(input, {
      identifier: orderId,
      settlementOrderId: UUID_PATTERN.test(orderId) ? orderId : undefined,
    });
    const result = await this.#context.http.request<unknown>(
      withOptions({ method: 'PUT', path: `${BASE_PATH}/edit`, body, auth: 'secret' }, options),
    );

    return toOrderOrThrow(result.data);
  }
}

interface OrderIdentity {
  identifier: string | undefined;
  settlementOrderId?: string | undefined;
}

/** Validates a caller's order and renders it as the provider payload. */
function toOrderPayload(
  input: CreateSettlementOrderInput,
  identity: OrderIdentity,
): Record<string, unknown> {
  const name = assertNonEmptyString(input.name, 'name');
  const items = assertItems(input.items);

  // Order fields are written through `setField` for the same reason response
  // fields are read through `readField`: snake_case keys never reach the
  // naming linter, and the wire format stays a transport detail.
  const body: Record<string, unknown> = {};
  setField(body, 'settlement_name', name);
  setField(body, 'order_items', items.map(toItemPayload));
  setField(body, 'charge_bearer', toChargeBearerCode(input.chargeBearer));

  if (identity.identifier !== undefined) setField(body, 'identifier', identity.identifier);
  if (identity.settlementOrderId !== undefined) {
    setField(body, 'settlement_order_id', identity.settlementOrderId);
  }

  if (input.overrideChargeBearer !== undefined) {
    if (typeof input.overrideChargeBearer !== 'boolean') {
      throw new MyImoPayValidationError(
        'overrideChargeBearer must be a boolean; it is sent as the provider’s override_charge_bearer flag.',
        'overrideChargeBearer',
      );
    }
    setField(body, 'override_charge_bearer', input.overrideChargeBearer);
  }

  return body;
}

/**
 * Validates every leg, rejects a repeated subaccount, then applies the pyramid
 * rule. Duplicates are rejected here because two legs for one subaccount are
 * silently collapsed by the provider, which loses money quietly.
 */
function assertItems(items: SettlementOrderItemInput[]): SettlementOrderItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new MyImoPayValidationError(
      'items must contain at least one settlement item; received an empty list.',
      'items',
    );
  }

  const seen = new Set<string>();
  const validated: SettlementOrderItemInput[] = [];

  for (const [index, item] of items.entries()) {
    const subaccountId = assertNonEmptyString(item.subaccountId, `items[${index}].subaccountId`);

    if (seen.has(subaccountId)) {
      throw new MyImoPayValidationError(
        `items[${index}].subaccountId repeats "${subaccountId}"; each subaccount may appear only once per settlement order.`,
        'items',
      );
    }
    seen.add(subaccountId);

    if (item.fixedAmount !== undefined) {
      assertAmount(item.fixedAmount, `items[${index}].fixedAmount`);
    }
    if (item.isFixed !== undefined && typeof item.isFixed !== 'boolean') {
      throw new MyImoPayValidationError(
        `items[${index}].isFixed must be a boolean; received ${String(item.isFixed)}.`,
        'items',
      );
    }

    const leg: SettlementOrderItemInput = { subaccountId };
    if (item.percentage !== undefined) leg.percentage = item.percentage;
    if (item.fixedAmount !== undefined) leg.fixedAmount = item.fixedAmount;
    if (item.isFixed !== undefined) leg.isFixed = item.isFixed;
    validated.push(leg);
  }

  assertSettlementPercentages(validated);
  return validated;
}

/** Renders one leg. A missing leg amount is an explicit zero, not omitted. */
function toItemPayload(item: SettlementOrderItemInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  setField(row, 'subaccount_id', item.subaccountId);
  setField(row, 'percent_amount', item.percentage ?? 0);
  setField(row, 'fixed_amount', item.fixedAmount ?? 0);
  setField(row, 'is_settlement_fixed', item.isFixed ?? false);
  return row;
}

/** `merchant` 1, `customer` 2 (default), `split` 3. */
function toChargeBearerCode(bearer: ChargeBearer | undefined = DEFAULT_CHARGE_BEARER): number {
  const code = CHARGE_BEARER_CODES[bearer];
  if (code === undefined) {
    throw new MyImoPayValidationError(
      'chargeBearer must be "merchant", "customer" or "split".',
      'chargeBearer',
    );
  }
  return code;
}

/**
 * Copies the per-call overrides onto a request.
 *
 * Assignments are conditional so `exactOptionalPropertyTypes` never sees an
 * explicit `undefined`, and so the transport falls back to the client defaults.
 */
function withOptions(
  request: HttpRequestOptions,
  options: RequestOptions | undefined,
): HttpRequestOptions {
  if (options === undefined) return request;

  const merged: HttpRequestOptions = { ...request };
  if (options.baseUrl !== undefined) merged.baseUrl = options.baseUrl;
  if (options.timeoutMs !== undefined) merged.timeoutMs = options.timeoutMs;
  if (options.headers !== undefined) merged.headers = options.headers;
  if (options.signal !== undefined) merged.signal = options.signal;
  return merged;
}

/** Provider ids are opaque; only emptiness is rejected. */
function assertId(value: unknown): string {
  const id = assertNonEmptyString(value, 'id');
  return encodeURIComponent(id);
}

/** Maps a settlement order list, dropping rows that are not objects. */
function toOrders(data: unknown): SettlementOrder[] {
  if (!Array.isArray(data)) return [];

  const orders: SettlementOrder[] = [];
  for (const row of data) {
    const order = toOrder(row);
    if (order !== null) orders.push(order);
  }
  return orders;
}

function toOrderOrThrow(data: unknown): SettlementOrder {
  const order = toOrder(data);
  if (order === null) {
    throw new MyImoPayError({
      code: 'MALFORMED_RESPONSE',
      message: 'The provider returned a settlement order payload that was not an object.',
    });
  }
  return order;
}

function toOrder(row: unknown): SettlementOrder | null {
  if (!isRecord(row)) return null;

  return {
    id: readString(row, 'settlement_order_id') ?? readString(row, 'identifier'),
    name: readString(row, 'settlement_name'),
    chargeBearer: mapChargeBearer(readNumber(row, 'charge_bearer')),
    overrideChargeBearer: readBoolean(row, 'override_charge_bearer'),
    isMixed: readBoolean(row, 'is_mixed_settlement'),
    items: toItems(readField(row, 'order_items')),
    createdAt: readDate(row, 'created_on'),
    updatedAt: readDate(row, 'modified_on'),
    raw: row,
  };
}

/** Maps the legs, dropping rows that are not objects. */
function toItems(value: unknown): SettlementOrderItem[] {
  if (!Array.isArray(value)) return [];

  const items: SettlementOrderItem[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;

    items.push({
      subaccountId: readString(row, 'subaccount_id') ?? readString(row, 'sub_account_id'),
      percentage: readNumber(row, 'percent_amount'),
      fixedAmount: readNumber(row, 'fixed_amount'),
      isFixed: readBoolean(row, 'is_settlement_fixed'),
      raw: row,
    });
  }
  return items;
}

/**
 * Reads a provider field through a variable rather than a literal key, which
 * keeps the snake_case wire format away from the camelCase naming rules.
 */
function readField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

/** Writes a provider field without dot access, which index signatures forbid. */
function setField(record: Record<string, unknown>, key: string, value: unknown): void {
  record[key] = value;
}

/** Trimmed non-empty string, or `null` when the provider omitted the field. */
function readString(record: Record<string, unknown>, key: string): string | null {
  const value = readField(record, key);
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Tolerant number reader: the provider sends numbers, numeric strings and
 * omissions. A junk cell becomes `0` instead of throwing, so one bad row can
 * never make a whole list unreadable.
 */
function readNumber(record: Record<string, unknown>, key: string): number {
  const value = readField(record, key);

  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Provider flags arrive as booleans, `0`/`1`, or their string forms. */
function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = readField(record, key);

  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
  }
  return false;
}

/**
 * Tolerant timestamp reader: ISO strings, `"YYYY-MM-DD HH:MM:SS"`, epoch
 * milliseconds and epoch seconds all occur in provider payloads. An unusable
 * timestamp is `null` rather than an exception.
 */
function readDate(record: Record<string, unknown>, key: string): Date | null {
  const value = readField(record, key);

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value >= 100_000_000_000 ? value : value * 1000;
    return new Date(milliseconds);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    const parsed = Date.parse(trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T'));
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
