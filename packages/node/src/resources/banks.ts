// @sdk-owner: A7-entities
// @sdk-phase: 2
// @sdk-implemented-by: A7-entities

import type { Bank, BankAccount, HttpRequestOptions, RequestOptions } from '@myimopay/core';
import {
  assertNonEmptyString,
  MyImoPayError,
  MyImoPayValidationError,
  normalizeCountryCode,
} from '@myimopay/core';
import type { ResourceContext } from '../context';

/**
 * One URL path segment. Bank codes and account numbers are digits on the wire;
 * letters are tolerated because SWIFT-style codes appear in the same namespace.
 * Anything with a space, slash or `..` is rejected before it can reshape a URL.
 */
const SEGMENT_PATTERN = /^[0-9A-Za-z]+$/;

/** Bank directory root. */
const BASE_PATH = '/vi/entities/banks';

/** Bank directory and account-name resolution. */
export class BanksResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  /**
   * Banks for an ISO-3166 alpha-2 country (`NG`).
   *
   * An empty provider answer (`data: null`) is an empty list, never an error.
   */
  async list(countryCode: string, options?: RequestOptions): Promise<Bank[]> {
    const country = normalizeCountryCode(countryCode);
    const result = await this.#context.http.request<unknown>(
      withOptions(
        { method: 'GET', path: `${BASE_PATH}/${country}`, auth: 'public', allowEmpty: true },
        options,
      ),
    );

    return toBanks(result.data);
  }

  /**
   * Resolves an account name before creating a subaccount.
   *
   * The answer is the payer's registered name; it is the only way to catch a
   * mistyped account number before money is routed to it.
   */
  async resolve(
    input: { bankCode: string; accountNumber: string },
    options?: RequestOptions,
  ): Promise<BankAccount> {
    const bankCode = assertPathSegment(input.bankCode, 'bankCode');
    const accountNumber = assertPathSegment(input.accountNumber, 'accountNumber');
    const path = `${BASE_PATH}/account/${bankCode}/${accountNumber}/resolve`;
    const result = await this.#context.http.request<unknown>(
      withOptions({ method: 'GET', path, auth: 'public' }, options),
    );

    return toBankAccount(result.data);
  }
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

/** Rejects a value that cannot travel as a single path segment. */
function assertPathSegment(value: unknown, field: string): string {
  const segment = assertNonEmptyString(value, field);

  if (!SEGMENT_PATTERN.test(segment)) {
    throw new MyImoPayValidationError(
      `${field} may only contain letters and digits, so it is safe in a URL path; received "${segment}".`,
      field,
    );
  }
  return segment;
}

/** Maps a bank directory payload, dropping rows that are not objects. */
function toBanks(data: unknown): Bank[] {
  if (!Array.isArray(data)) return [];

  const banks: Bank[] = [];
  for (const row of data) {
    const bank = toBank(row);
    if (bank !== null) banks.push(bank);
  }
  return banks;
}

function toBank(row: unknown): Bank | null {
  if (!isRecord(row)) return null;

  return {
    code: readString(row, 'bank_code'),
    name: readString(row, 'bank_name'),
    countryCode: readString(row, 'alpha_two'),
    // The provider sends both; either identifies the bank internationally.
    swiftCode: readString(row, 'swift_code') ?? readString(row, 'bic'),
    bankType: readString(row, 'bank_type'),
    routingNumber: readString(row, 'routing_number'),
    raw: row,
  };
}

/** Maps the single resolved account. A non-object payload cannot be modelled. */
function toBankAccount(data: unknown): BankAccount {
  if (!isRecord(data)) {
    throw new MyImoPayError({
      code: 'MALFORMED_RESPONSE',
      message: 'The provider returned an account resolution that was not an object.',
    });
  }

  return {
    bankCode: readString(data, 'bank_code'),
    accountNumber: readString(data, 'account_number'),
    accountName: readString(data, 'account_name'),
    branchCode: readString(data, 'branch_code'),
    raw: data,
  };
}

/**
 * Reads a provider field through a variable rather than a literal key, which
 * keeps the snake_case wire format away from the camelCase naming rules.
 */
function readField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

/** Trimmed non-empty string, or `null` when the provider omitted the field. */
function readString(record: Record<string, unknown>, key: string): string | null {
  const value = readField(record, key);
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
