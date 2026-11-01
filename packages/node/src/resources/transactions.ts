// @sdk-owner: A5-transactions
// @sdk-phase: 1
// @sdk-implemented-by: A5-transactions

import {
  type ApiResult,
  type DateRangeQuery,
  type HttpRequestOptions,
  MyImoPayApiError,
  MyImoPayValidationError,
  mapChargeBearer,
  mapPaymentStatus,
  type PaymentStatus,
  type ProviderRecord,
  type RequestOptions,
  type Transaction,
  type TransactionPage,
  type TransactionQuery,
  toNumberOr,
} from '@myimopay/core';
import type { ResourceContext } from '../context';

/**
 * The paging envelope of `/vi/transactions/filter` is not published. Each
 * property is probed under every name the provider has been seen to use, and a
 * missing name is `null` rather than an error.
 */
const PAGE_ITEMS_KEYS = ['items', 'records', 'data'] as const;
const PAGE_TOTAL_KEYS = ['total', 'totalCount'] as const;
const PAGE_NUMBER_KEYS = ['page', 'pageNumber'] as const;
const PAGE_SIZE_KEYS = ['pageSize', 'page_size', 'size'] as const;

/** Provider integers for the statuses the caller may name. `unknown` has none. */
const WIRE_STATUS: Readonly<Record<Exclude<PaymentStatus, 'unknown'>, number>> = {
  initiated: 0,
  pending: 1,
  succeeded: 2,
  failed: 3,
  expired: 4,
};

/** Read-only transaction history (`/vi/transactions*`). */
export class TransactionsResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  /** Full unpaginated list. Prefer `filter()` for anything user-facing. */
  async list(options?: RequestOptions): Promise<Transaction[]> {
    const result = await this.#get('/vi/transactions', options);
    return this.#mapRows(result.data);
  }

  /** Paginated, filtered list. */
  async filter(query?: TransactionQuery, options?: RequestOptions): Promise<TransactionPage> {
    const result = await this.#get('/vi/transactions/filter', options, buildFilterQuery(query));
    return this.#toPage(result.data);
  }

  /** A missing reference resolves to `null`; every other failure propagates. */
  async findByReference(reference: string, options?: RequestOptions): Promise<Transaction | null> {
    return this.#findOne(`/vi/transactions/reference/${encodeURIComponent(reference)}`, options);
  }

  /** A missing identifier resolves to `null`; every other failure propagates. */
  async findById(identifier: string, options?: RequestOptions): Promise<Transaction | null> {
    return this.#findOne(`/vi/transactions/identity/${encodeURIComponent(identifier)}`, options);
  }

  /** Provider-shaped totals. Deliberately not re-modelled. */
  async summary(range?: DateRangeQuery, options?: RequestOptions): Promise<ProviderRecord> {
    const fromDate = toWireDate(range?.fromDate, 'fromDate');
    const toDate = toWireDate(range?.toDate, 'toDate');
    // A one-sided window is meaningless to the provider, so it is not sent.
    const query = fromDate !== undefined && toDate !== undefined ? { fromDate, toDate } : undefined;

    const result = await this.#get('/vi/transactions/summary', options, query);
    return asRecord(result.data);
  }

  /** Provider-shaped status histogram. Deliberately not re-modelled. */
  async statusCounts(options?: RequestOptions): Promise<ProviderRecord> {
    const result = await this.#get('/vi/transactions/status-counts', options);
    return asRecord(result.data);
  }

  /** Provider-shaped analytics window. `days` is sent only when it is a positive integer. */
  async analytics(days?: number, options?: RequestOptions): Promise<ProviderRecord> {
    const query = days !== undefined && Number.isInteger(days) && days > 0 ? { days } : undefined;

    const result = await this.#get('/vi/transactions/analytics', options, query);
    return asRecord(result.data);
  }

  /** The single transport call every read route funnels through. */
  async #get(
    path: string,
    options: RequestOptions | undefined,
    query?: HttpRequestOptions['query'],
  ): Promise<ApiResult<unknown>> {
    const request: HttpRequestOptions = { method: 'GET', path, auth: 'public', allowEmpty: true };
    if (query !== undefined) request.query = query;
    if (options?.baseUrl !== undefined) request.baseUrl = options.baseUrl;
    if (options?.timeoutMs !== undefined) request.timeoutMs = options.timeoutMs;
    if (options?.headers !== undefined) request.headers = options.headers;
    if (options?.signal !== undefined) request.signal = options.signal;

    return this.#context.http.request<unknown>(request);
  }

  /** A 404 is "nothing matched"; `data: null` is the same answer. */
  async #findOne(path: string, options?: RequestOptions): Promise<Transaction | null> {
    let result: ApiResult<unknown>;
    try {
      result = await this.#get(path, options);
    } catch (error) {
      if (error instanceof MyImoPayApiError && error.status === 404) return null;
      throw error;
    }

    return this.#toTransaction(result.data);
  }

  /**
   * The one transaction mapper. Every endpoint that returns a transaction uses
   * it, so no two routes can disagree about what a field means.
   *
   * Returns `null` for anything that is not a provider row: a provider adding
   * junk to a list must not break a merchant dashboard.
   */
  #toTransaction(raw: unknown): Transaction | null {
    if (!isRecord(raw)) return null;

    const isSettled = field(raw, 'is_settled') === true;
    const rawStatus = readOptionalNumber(field(raw, 'status'));

    return {
      id: readString(field(raw, 'identifier')),
      reference: readString(field(raw, 'tx_reference')),
      providerReference: readString(field(raw, 'provider_reference')),
      payReference: readString(field(raw, 'pay_reference')),
      // `is_settled: true` beats the integer, exactly as the provider intends.
      status: mapPaymentStatus(rawStatus, isSettled),
      rawStatus,
      isSettled,
      isSplit: field(raw, 'is_split') === true,
      // `Transaction.currency` is not nullable; the provider always sends it,
      // and an absent value is reported as empty rather than invented.
      currency: readString(field(raw, 'currency')) ?? '',
      amountInitial: readAmount(field(raw, 'initial_amount'), 'initial_amount'),
      amountCharged: readAmount(field(raw, 'charged_amount'), 'charged_amount'),
      amountPaid: readAmount(field(raw, 'paid_amount'), 'paid_amount'),
      amountPayout: readAmount(field(raw, 'payout_amount'), 'payout_amount'),
      feeAmount: readAmount(field(raw, 'fee_amount'), 'fee_amount'),
      taxAmount: readAmount(field(raw, 'tax_amount'), 'tax_amount'),
      adminFeeAmount: readAmount(field(raw, 'admin_fee_amount'), 'admin_fee_amount'),
      chargeBearer: mapChargeBearer(readOptionalNumber(field(raw, 'charge_bearer'))),
      customerName: readString(field(raw, 'customer_name')),
      customerEmail: readString(field(raw, 'customer_email')),
      customerPhone: readString(field(raw, 'customer_phone')),
      settlementOrderId: readString(field(raw, 'settlement_order_id')),
      callbackUrl: readString(field(raw, 'callback_url')),
      paymentLink: readString(field(raw, 'payment_link')),
      expiresAt: readDate(field(raw, 'expiration_time')),
      createdAt: readDate(field(raw, 'created_on')),
      updatedAt: readDate(field(raw, 'modified_on')),
      raw,
    };
  }

  /** Maps provider rows, dropping anything that is not an object. */
  #mapRows(value: unknown): Transaction[] {
    if (!Array.isArray(value)) return [];

    const rows: Transaction[] = [];
    for (const row of value) {
      const transaction = this.#toTransaction(row);
      if (transaction !== null) rows.push(transaction);
    }
    return rows;
  }

  /**
   * Accepts a bare array, an object carrying the rows under any of the observed
   * names, or nothing at all. Paging metadata that is not there is `null`.
   */
  #toPage(raw: unknown): TransactionPage {
    if (Array.isArray(raw)) {
      return { items: this.#mapRows(raw), total: null, page: null, pageSize: null, raw };
    }
    if (!isRecord(raw)) {
      return { items: [], total: null, page: null, pageSize: null, raw };
    }

    return {
      items: this.#mapRows(firstArray(raw, PAGE_ITEMS_KEYS)),
      total: firstNumber(raw, PAGE_TOTAL_KEYS),
      page: firstNumber(raw, PAGE_NUMBER_KEYS),
      pageSize: firstNumber(raw, PAGE_SIZE_KEYS),
      raw,
    };
  }
}

/** Serialises the filter query; `undefined` stays off the wire. */
function buildFilterQuery(query: TransactionQuery | undefined): HttpRequestOptions['query'] {
  if (query === undefined) return undefined;

  const wire: Record<string, string | number | boolean | undefined> = {};
  put(wire, 'page', query.page);
  put(wire, 'pageSize', query.pageSize);
  put(wire, 'status', query.status === undefined ? undefined : toWireStatus(query.status));
  put(wire, 'fromDate', toWireDate(query.fromDate, 'fromDate'));
  put(wire, 'toDate', toWireDate(query.toDate, 'toDate'));
  put(wire, 'search', query.search);
  put(wire, 'sortBy', query.sortBy);
  put(wire, 'sortOrder', query.sortOrder);

  return Object.keys(wire).length === 0 ? undefined : wire;
}

/**
 * Named statuses become the provider's integers. `unknown` has no integer, so
 * it is passed through untouched instead of being mapped to a guess.
 */
function toWireStatus(status: PaymentStatus | number): string | number {
  if (typeof status === 'number') return status;
  if (status === 'unknown') return status;
  return WIRE_STATUS[status];
}

/** A `Date` is sent as ISO-8601; a caller-supplied string is already wire-shaped. */
function toWireDate(value: string | Date | undefined, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (Number.isNaN(value.getTime())) {
    throw new MyImoPayValidationError(`${fieldName} is an invalid Date.`, fieldName);
  }
  return value.toISOString();
}

/**
 * Reads a provider field by name. Access through a variable rather than a
 * literal keeps the biome key rules and `noPropertyAccessFromIndexSignature`
 * from fighting each other over the snake_case wire format.
 */
function field(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function put(
  target: Record<string, string | number | boolean | undefined>,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed non-empty string, else `null`. */
function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** A provider number as a number, or `null` when it is absent or unusable. */
function readOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Amounts normalise through `toNumberOr`, with `0` as the fallback. A value that
 * is neither absent nor numeric (a stray `"N/A"`) also falls back to `0`: one
 * odd row must not take a whole report down.
 */
function readAmount(value: unknown, key: string): number {
  const numeric = typeof value === 'number' || typeof value === 'string' ? value : null;
  try {
    return toNumberOr(numeric, key, 0);
  } catch {
    return 0;
  }
}

/** Defensive date parse: anything unparseable is `null`, never `Invalid Date`. */
function readDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firstArray(record: Record<string, unknown>, keys: ReadonlyArray<string>): unknown {
  for (const key of keys) {
    const value = field(record, key);
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: ReadonlyArray<string>): number | null {
  for (const key of keys) {
    const value = readOptionalNumber(field(record, key));
    if (value !== null) return value;
  }
  return null;
}

/** Provider-shaped payloads are handed back as-is; a non-object is an empty record. */
function asRecord(value: unknown): ProviderRecord {
  return isRecord(value) ? value : {};
}
