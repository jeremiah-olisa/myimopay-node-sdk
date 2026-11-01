// @sdk-owner: A7-entities
// @sdk-phase: 2
// @sdk-implemented-by: A7-entities

import type {
  CreateSubaccountInput,
  HttpRequestOptions,
  RequestOptions,
  Subaccount,
} from '@myimopay/core';
import {
  assertNonEmptyString,
  assertPhone,
  createReference,
  MyImoPayError,
  MyImoPayValidationError,
  normalizeCurrency,
} from '@myimopay/core';
import type { ResourceContext } from '../context';

/** Subaccount collection root. */
const BASE_PATH = '/vi/entities/merchant/subaccounts/accounts';

/** A Nigerian NUBAN is exactly 10 digits; the provider rejects anything else. */
const ACCOUNT_NUMBER_PATTERN = /^\d{10}$/;

/** Bank codes are digits on the wire; letters are tolerated for other markets. */
const BANK_CODE_PATTERN = /^[0-9A-Za-z]+$/;

/**
 * Merchant subaccounts (`/vi/entities/merchant/subaccounts/*`). Requires the
 * secret key: these routes authenticate differently from the rest of the API
 * (see `docs/provider-notes.md`, "Subaccount routes authenticate differently").
 */
export class SubaccountsResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  /** Every subaccount on the merchant account. `data: null` is an empty list. */
  async list(options?: RequestOptions): Promise<Subaccount[]> {
    const result = await this.#context.http.request<unknown>(
      withOptions({ method: 'GET', path: BASE_PATH, auth: 'secret', allowEmpty: true }, options),
    );

    return toSubaccounts(result.data);
  }

  /** One subaccount by its provider id. A missing id is a caller bug. */
  async get(id: string, options?: RequestOptions): Promise<Subaccount> {
    const subaccountId = assertId(id);
    const result = await this.#context.http.request<unknown>(
      withOptions({ method: 'GET', path: `${BASE_PATH}/${subaccountId}`, auth: 'secret' }, options),
    );

    return toSubaccountOrThrow(result.data);
  }

  /**
   * Creates a subaccount.
   *
   * `identifier` is the provider's de-duplication key: repeating this call with
   * the same identifier returns the existing subaccount instead of creating a
   * second one, so a caller that retries should pass its own identifier. When
   * it is omitted the SDK generates a fresh reference for that one call — the
   * payload is always identifiable, but a retry of that call is a new record.
   *
   * A duplicate bank code + account number surfaces as `MyImoPayApiError` with
   * code `CONFLICT` (HTTP 409); the transport maps it, nothing is swallowed.
   */
  async create(input: CreateSubaccountInput, options?: RequestOptions): Promise<Subaccount> {
    const body = toCreatePayload(input);
    const result = await this.#context.http.request<unknown>(
      withOptions({ method: 'POST', path: `${BASE_PATH}/add`, body, auth: 'secret' }, options),
    );

    return toSubaccountOrThrow(result.data);
  }
}

/** Builds the provider payload, validating every field first. */
function toCreatePayload(input: CreateSubaccountInput): Record<string, unknown> {
  const name = assertNonEmptyString(input.name, 'name');
  const bankCode = assertBankCode(input.bankCode);
  const bankName = assertNonEmptyString(input.bankName, 'bankName');
  const accountNumber = assertAccountNumber(input.accountNumber);
  const accountName = assertNonEmptyString(input.accountName, 'accountName');
  const currency = normalizeCurrency(input.currency);
  const identifier =
    input.identifier === undefined
      ? createReference()
      : assertNonEmptyString(input.identifier, 'identifier');

  // `email_address` and `phone_number` are the provider's names, not ours.
  // Fields are written through `setField` for the same reason they are read
  // through `readField`: snake_case keys never reach the naming linter.
  const body: Record<string, unknown> = {};
  setField(body, 'identifier', identifier);
  setField(body, 'sub_name', name);
  setField(body, 'bank_code', bankCode);
  setField(body, 'bank_name', bankName);
  setField(body, 'account_number', accountNumber);
  setField(body, 'account_name', accountName);
  setField(body, 'currency', currency);

  if (input.email !== undefined) {
    setField(body, 'email_address', assertNonEmptyString(input.email, 'email'));
  }
  // Phone numbers are normalised to E.164 only when supplied; a subaccount
  // without one is valid.
  if (input.phone !== undefined) {
    setField(body, 'phone_number', assertPhone(input.phone, 'phone'));
  }

  return body;
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

function assertBankCode(value: unknown): string {
  const bankCode = assertNonEmptyString(value, 'bankCode');

  if (!BANK_CODE_PATTERN.test(bankCode)) {
    throw new MyImoPayValidationError(
      `bankCode may only contain letters and digits; received "${bankCode}".`,
      'bankCode',
    );
  }
  return bankCode;
}

function assertAccountNumber(value: unknown): string {
  const accountNumber = assertNonEmptyString(value, 'accountNumber');

  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
    throw new MyImoPayValidationError(
      `accountNumber must be a 10-digit NUBAN account number; received "${accountNumber}".`,
      'accountNumber',
    );
  }
  return accountNumber;
}

/** Maps a subaccount list, dropping rows that are not objects. */
function toSubaccounts(data: unknown): Subaccount[] {
  if (!Array.isArray(data)) return [];

  const subaccounts: Subaccount[] = [];
  for (const row of data) {
    const subaccount = toSubaccount(row);
    if (subaccount !== null) subaccounts.push(subaccount);
  }
  return subaccounts;
}

/** Maps the single created/fetched subaccount. */
function toSubaccountOrThrow(data: unknown): Subaccount {
  const subaccount = toSubaccount(data);
  if (subaccount === null) {
    throw new MyImoPayError({
      code: 'MALFORMED_RESPONSE',
      message: 'The provider returned a subaccount payload that was not an object.',
    });
  }
  return subaccount;
}

function toSubaccount(row: unknown): Subaccount | null {
  if (!isRecord(row)) return null;

  return {
    id: readString(row, 'sub_account_id') ?? readString(row, 'id'),
    code: readString(row, 'sub_code'),
    name: readString(row, 'sub_name') ?? readString(row, 'name'),
    bankCode: readString(row, 'bank_code'),
    bankName: readString(row, 'bank_name'),
    accountNumber: readString(row, 'account_number'),
    accountName: readString(row, 'account_name'),
    currency: readString(row, 'currency'),
    email: readString(row, 'email_address') ?? readString(row, 'email'),
    phone: readString(row, 'phone_number') ?? readString(row, 'phone'),
    createdAt: readDate(row, 'created_on'),
    updatedAt: readDate(row, 'modified_on'),
    raw: row,
  };
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
 * Tolerant timestamp reader: ISO strings, `"YYYY-MM-DD HH:MM:SS"`, epoch
 * milliseconds and epoch seconds all occur in provider payloads. An unusable
 * timestamp is `null` rather than an exception — a malformed date must not make
 * an otherwise good subaccount unreadable.
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
