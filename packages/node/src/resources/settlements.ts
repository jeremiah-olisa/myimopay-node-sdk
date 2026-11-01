// @sdk-implemented-by: A6-settlements

import {
  assertNonEmptyString,
  type ChargeBearer,
  type DirectSettlement,
  type HttpRequestOptions,
  MyImoPayApiError,
  MyImoPayError,
  MyImoPayValidationError,
  mapChargeBearer,
  mapPaymentStatus,
  type RequestOptions,
  type SettlementQuery,
  type SplitAllocation,
  type SplitSettlement,
} from '@myimopay/core';
import type { ResourceContext } from '../context';

const DIRECTS_PATH = '/vi/settlements/directs';
const SPLITS_PATH = '/vi/settlements/splits';
const DATE_RANGE_SUFFIX = '/filter/daterange';
const REFERENCE_SUFFIX = '/transaction/ref';

/** Wire aliases; the report columns are not fully published, so every known name is read. */
const REFERENCE_KEYS = ['tx_reference', 'reference'] as const;
const PROVIDER_REFERENCE_KEYS = ['provider_reference', 'pay_reference'] as const;
const STATUS_KEYS = ['status'] as const;
const IS_SETTLED_KEYS = ['is_settled'] as const;
const CURRENCY_KEYS = ['currency', 'settlement_currency'] as const;
const AMOUNT_KEYS = ['amount', 'transaction_amount'] as const;
const SETTLED_AMOUNT_KEYS = ['settled_amount', 'settlement_amount', 'payout_amount'] as const;
const FEE_AMOUNT_KEYS = ['fee_amount'] as const;
const TAX_AMOUNT_KEYS = ['tax_amount'] as const;
const ADMIN_FEE_KEYS = ['admin_fee_amount'] as const;
const CHARGE_BEARER_KEYS = ['charge_bearer'] as const;
const SETTLEMENT_ORDER_ID_KEYS = ['settlement_order_id'] as const;
const SETTLED_AT_KEYS = ['settled_on', 'settlement_date', 'created_on'] as const;
const ALLOCATION_KEYS = ['allocations', 'settlement_items', 'order_items'] as const;
const SUBACCOUNT_ID_KEYS = ['subaccount_id'] as const;
const PERCENT_AMOUNT_KEYS = ['percent_amount'] as const;
const FIXED_AMOUNT_KEYS = ['fixed_amount'] as const;
const IS_FIXED_KEYS = ['is_settlement_fixed', 'is_fixed'] as const;

const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const DEFAULT_CURRENCY = 'NGN';

/**
 * The transport reports a successful envelope whose `data` is `null` as
 * `MALFORMED_RESPONSE`. For settlement reads that is the provider's "nothing
 * matched" signal (see `docs/provider-notes.md` §5), so it becomes an empty
 * result here. Every other malformed response still propagates; the transport
 * should expose a distinct empty signal so this message check can go away.
 */

/** A row exactly as the provider sent it. */
type Row = Record<string, unknown>;

/**
 * Settlement reports (`/vi/settlements/*`).
 *
 * These endpoints signal "nothing matched" with a 404 envelope or `data: null`.
 * Both mean an empty list, never an error.
 */
export class SettlementsResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  async directs(query?: SettlementQuery, options?: RequestOptions): Promise<DirectSettlement[]> {
    const window = resolveWindow(query);
    const rows = await this.#list(
      window === null ? DIRECTS_PATH : `${DIRECTS_PATH}${DATE_RANGE_SUFFIX}`,
      window,
      options,
    );
    return collect(rows, mapDirectSettlement);
  }

  async splits(query?: SettlementQuery, options?: RequestOptions): Promise<SplitSettlement[]> {
    const window = resolveWindow(query);
    const rows = await this.#list(
      window === null ? SPLITS_PATH : `${SPLITS_PATH}${DATE_RANGE_SUFFIX}`,
      window,
      options,
    );
    return collect(rows, mapSplitSettlement);
  }

  /** A missing reference is a legitimate `null`, not an error. */
  async directByReference(
    reference: string,
    options?: RequestOptions,
  ): Promise<DirectSettlement | null> {
    const row = await this.#single(referencePath(DIRECTS_PATH, reference), options);
    return row === null ? null : mapDirectSettlement(row);
  }

  /** A missing reference is a legitimate `null`, not an error. */
  async splitByReference(
    reference: string,
    options?: RequestOptions,
  ): Promise<SplitSettlement | null> {
    const row = await this.#single(referencePath(SPLITS_PATH, reference), options);
    return row === null ? null : mapSplitSettlement(row);
  }

  async splitByOrder(
    settlementOrderId: string,
    options?: RequestOptions,
  ): Promise<SplitSettlement[]> {
    const id = assertNonEmptyString(settlementOrderId, 'settlementOrderId');
    const rows = await this.#list(`${SPLITS_PATH}/order/${encodeURIComponent(id)}`, null, options);
    return collect(rows, mapSplitSettlement);
  }

  /** Reads a report list; an empty answer is `[]`, never an error. */
  async #list(
    path: string,
    query: Record<string, string> | null,
    options: RequestOptions | undefined,
  ): Promise<unknown[]> {
    const request: HttpRequestOptions = { method: 'GET', path, auth: 'public', allowEmpty: true };
    if (query !== null) request.query = query;
    applyRequestOptions(request, options);

    try {
      const result = await this.#context.http.request<unknown>(request);
      return asRows(result.data);
    } catch (error) {
      if (isEmptyResult(error)) return [];
      throw error;
    }
  }

  /** Reads one row; an empty answer is `null`, never an error. */
  async #single(path: string, options: RequestOptions | undefined): Promise<unknown | null> {
    const request: HttpRequestOptions = { method: 'GET', path, auth: 'public', allowEmpty: true };
    applyRequestOptions(request, options);

    try {
      const result = await this.#context.http.request<unknown>(request);
      return firstRow(result.data);
    } catch (error) {
      if (isEmptyResult(error)) return null;
      throw error;
    }
  }
}

/** Applies only the per-call overrides the caller actually supplied. */
function applyRequestOptions(
  request: HttpRequestOptions,
  options: RequestOptions | undefined,
): void {
  if (options === undefined) return;
  if (options.signal !== undefined) request.signal = options.signal;
  if (options.timeoutMs !== undefined) request.timeoutMs = options.timeoutMs;
  if (options.headers !== undefined) request.headers = options.headers;
  if (options.baseUrl !== undefined) request.baseUrl = options.baseUrl;
}

/**
 * The date filter is all-or-nothing: the filter route needs both bounds, and
 * silently dropping one would return the whole report instead of a window.
 */
function resolveWindow(query: SettlementQuery | undefined): Record<string, string> | null {
  const from = query?.fromDate;
  const to = query?.toDate;

  if (from === undefined && to === undefined) return null;
  if (from === undefined || to === undefined) {
    const missing = from === undefined ? 'fromDate' : 'toDate';
    throw new MyImoPayValidationError(
      'A settlement date window needs both fromDate and toDate; supply both or neither.',
      missing,
    );
  }

  return {
    from: toIsoString(from, 'fromDate'),
    to: toIsoString(to, 'toDate'),
  };
}

function toIsoString(value: string | Date, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new MyImoPayValidationError(
      `${field} must be a valid Date or date string; received ${JSON.stringify(value)}.`,
      field,
    );
  }
  return date.toISOString();
}

function referencePath(base: string, reference: string): string {
  const value = assertNonEmptyString(reference, 'reference');
  return `${base}${REFERENCE_SUFFIX}/${encodeURIComponent(value)}`;
}

function asRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data === null || data === undefined) return [];
  throw new MyImoPayError({
    code: 'MALFORMED_RESPONSE',
    message: 'The provider returned a settlement payload that is not a list of rows.',
  });
}

function firstRow(data: unknown): unknown | null {
  if (Array.isArray(data)) return data[0] ?? null;
  if (data === null || data === undefined) return null;
  return data;
}

/** True when the failure is the provider's "nothing matched", not a real error. */
function isEmptyResult(error: unknown): boolean {
  if (error instanceof MyImoPayApiError) {
    return error.status === 404 && isEmptyRemark(error.remark);
  }
  return false;
}

/** `"No settlements found."` and `"Not found."` are empty; `"Unauthorized"` is not. */
function isEmptyRemark(remark: string | null): boolean {
  if (remark === null) return false;
  const lower = remark.toLowerCase();
  return lower.includes('not found') || /\bno\b[\s\S]*\bfound\b/.test(lower);
}

function collect<T>(rows: readonly unknown[], map: (row: unknown) => T | null): T[] {
  const mapped: T[] = [];
  for (const row of rows) {
    const value = map(row);
    if (value !== null) mapped.push(value);
  }
  return mapped;
}

function mapDirectSettlement(row: unknown): DirectSettlement | null {
  if (!isSettlementRow(row)) return null;
  const rawStatus = numeric(row, STATUS_KEYS);

  return {
    reference: text(row, REFERENCE_KEYS),
    providerReference: text(row, PROVIDER_REFERENCE_KEYS),
    status: mapPaymentStatus(rawStatus, flag(row, IS_SETTLED_KEYS)),
    rawStatus,
    currency: currencyOf(row),
    amount: numberOr(row, AMOUNT_KEYS, 0),
    settledAmount: numberOr(row, SETTLED_AMOUNT_KEYS, 0),
    feeAmount: numberOr(row, FEE_AMOUNT_KEYS, 0),
    taxAmount: numberOr(row, TAX_AMOUNT_KEYS, 0),
    adminFeeAmount: numberOr(row, ADMIN_FEE_KEYS, 0),
    chargeBearer: chargeBearerOf(row),
    settlementOrderId: text(row, SETTLEMENT_ORDER_ID_KEYS),
    settledAt: isoDate(row, SETTLED_AT_KEYS),
    raw: row,
  };
}

function mapSplitSettlement(row: unknown): SplitSettlement | null {
  if (!isSettlementRow(row)) return null;
  const rawStatus = numeric(row, STATUS_KEYS);

  return {
    reference: text(row, REFERENCE_KEYS),
    providerReference: text(row, PROVIDER_REFERENCE_KEYS),
    settlementOrderId: text(row, SETTLEMENT_ORDER_ID_KEYS),
    status: mapPaymentStatus(rawStatus, flag(row, IS_SETTLED_KEYS)),
    rawStatus,
    currency: currencyOf(row),
    amount: numberOr(row, AMOUNT_KEYS, 0),
    settledAmount: numberOr(row, SETTLED_AMOUNT_KEYS, 0),
    feeAmount: numberOr(row, FEE_AMOUNT_KEYS, 0),
    taxAmount: numberOr(row, TAX_AMOUNT_KEYS, 0),
    adminFeeAmount: numberOr(row, ADMIN_FEE_KEYS, 0),
    allocations: mapAllocations(row),
    settledAt: isoDate(row, SETTLED_AT_KEYS),
    raw: row,
  };
}

function mapAllocations(row: Row): SplitAllocation[] {
  const allocations: SplitAllocation[] = [];

  for (const item of allocationItems(row)) {
    const subaccountId = text(item, SUBACCOUNT_ID_KEYS);
    const percentAmount = numeric(item, PERCENT_AMOUNT_KEYS);
    const fixedAmount = numeric(item, FIXED_AMOUNT_KEYS);
    if (subaccountId === null && percentAmount === null && fixedAmount === null) continue;

    allocations.push({
      subaccountId,
      percentAmount: percentAmount ?? 0,
      fixedAmount: fixedAmount ?? 0,
      isFixed: flag(item, IS_FIXED_KEYS),
      raw: item,
    });
  }

  return allocations;
}

function allocationItems(row: Row): Row[] {
  for (const key of ALLOCATION_KEYS) {
    const value = row[key];
    if (!Array.isArray(value)) continue;
    return value.filter(isRecord);
  }
  return [];
}

/**
 * A row is junk when it carries nothing the SDK models. Such rows are dropped
 * rather than mapped into an all-null settlement.
 */
function isSettlementRow(row: unknown): row is Row {
  if (!isRecord(row)) return false;
  return (
    text(row, REFERENCE_KEYS) !== null ||
    text(row, PROVIDER_REFERENCE_KEYS) !== null ||
    text(row, SETTLEMENT_ORDER_ID_KEYS) !== null ||
    numeric(row, AMOUNT_KEYS) !== null ||
    numeric(row, SETTLED_AMOUNT_KEYS) !== null
  );
}

function currencyOf(row: Row): string {
  const currency = text(row, CURRENCY_KEYS);
  return currency !== null && CURRENCY_PATTERN.test(currency)
    ? currency.toUpperCase()
    : DEFAULT_CURRENCY;
}

function chargeBearerOf(row: Row): ChargeBearer | null {
  const mapped = mapChargeBearer(numeric(row, CHARGE_BEARER_KEYS));
  if (mapped !== null) return mapped;

  switch (text(row, CHARGE_BEARER_KEYS)?.toLowerCase()) {
    case 'merchant':
      return 'merchant';
    case 'customer':
      return 'customer';
    case 'split':
      return 'split';
    default:
      return null;
  }
}

/** First present alias, trimmed to a non-empty string, or `null`. */
function text(row: Row, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') return trimmed;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/** First alias that parses as a finite number, tolerating numeric strings. */
function numeric(row: Row, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') continue;
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function numberOr(row: Row, keys: readonly string[], fallback: number): number {
  return numeric(row, keys) ?? fallback;
}

/** Provider flags arrive as booleans, `0`/`1`, or their string forms. */
function flag(row: Row, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = row[key];
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    }
  }
  return false;
}

function isoDate(row: Row, keys: readonly string[]): Date | null {
  for (const key of keys) {
    const value = row[key];
    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) return value;
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
