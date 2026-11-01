// @sdk-owner: A4-payments
// @sdk-phase: 1
// @sdk-implemented-by: A4-payments

import {
  assertHttpsUrl,
  assertNonEmptyString,
  assertPhone,
  assertReference,
  createReference,
  deriveEmailFromPhone,
  type HttpAuthMode,
  type HttpRequestOptions,
  type InitiatePaymentInput,
  type InitiateSplitPaymentInput,
  MyImoPayError,
  MyImoPayValidationError,
  mapChargeBearer,
  mapPaymentStatus,
  type Numeric,
  normalizeCurrency,
  normalizeCustomerEmail,
  type PaymentInitiation,
  type RequestOptions,
  sanitizeCustomerName,
  toApiAmount,
  toNumberOr,
  type VerifiedPayment,
} from '@myimopay/core';
import type { ResourceContext } from '../context';
import type { PaymentEventBus } from '../events';
import { createPaymentEventBus } from '../events';

const INITIATE_PATH = '/vi/pay/initiate';
const INITIATE_SPLIT_PATH = '/vi/pay/initiate/split';
const VERIFY_PATH = '/vi/pay/verify';
const VERIFY_BY_ID_PATH = '/vi/pay/verify/id';

/** The provider documents a 24-hour payment link; used when `expires_on` is unusable. */
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Initiation wire field names, spelled once so the lint rules never fight over them. */
const WIRE = {
  txRef: 'tx_ref',
  amount: 'amount',
  currency: 'currency',
  fullName: 'customer_full_name',
  mobile: 'customer_mobile',
  email: 'customer_email',
  callbackUrl: 'callback_url',
  settlementOrderId: 'settlement_order_id',
} as const;

/**
 * A validated initiation, ready for the wire.
 *
 * The provider wants snake_case keys, which the naming lint forbids on object
 * literals, so the body is a plain string record built key by key.
 * `amount` is the fixed-point string from `toApiAmount`, never a number, so no
 * float rounding can reach the wire.
 */
interface PreparedInitiation {
  readonly reference: string;
  readonly amount: number;
  readonly currency: string;
  readonly body: Record<string, string>;
}

/** Initiation and verification. The only two things a checkout needs. */
export class PaymentsResource {
  readonly #context: ResourceContext;

  /**
   * Event-based lifecycle for a payment. Subscribe before the payer is
   * redirected, then feed verified webhook events in from your handler:
   * `payments.events.emit(event)`. No polling, no timers.
   */
  readonly events: PaymentEventBus;

  constructor(context: ResourceContext) {
    this.#context = context;
    this.events = createPaymentEventBus();
  }

  /** Creates a hosted-checkout payment. `reference` is the idempotency key. */
  async initiate(
    input: InitiatePaymentInput,
    options?: RequestOptions,
  ): Promise<PaymentInitiation> {
    return this.#create(input, INITIATE_PATH, 'public', options);
  }

  /** Creates a split payment against a settlement order. Requires the secret key. */
  async initiateSplit(
    input: InitiateSplitPaymentInput,
    options?: RequestOptions,
  ): Promise<PaymentInitiation> {
    const settlementOrderId = assertNonEmptyString(input.settlementOrderId, 'settlementOrderId');
    return this.#create(input, INITIATE_SPLIT_PATH, 'secret', options, settlementOrderId);
  }

  /** Verifies by `tx_ref`. This is the only proof of payment the SDK accepts. */
  async verify(reference: string, options?: RequestOptions): Promise<VerifiedPayment> {
    const checked = assertNonEmptyString(reference, 'reference');
    return this.#fetchVerified(`${VERIFY_PATH}/${encodeURIComponent(checked)}`, checked, options);
  }

  /** Verifies by the provider's internal identifier. */
  async verifyById(id: string, options?: RequestOptions): Promise<VerifiedPayment> {
    const checked = assertNonEmptyString(id, 'id');
    return this.#fetchVerified(
      `${VERIFY_BY_ID_PATH}/${encodeURIComponent(checked)}`,
      checked,
      options,
    );
  }

  async #create(
    input: InitiatePaymentInput,
    path: string,
    auth: HttpAuthMode,
    options: RequestOptions | undefined,
    settlementOrderId?: string,
  ): Promise<PaymentInitiation> {
    const prepared = prepareInitiation(
      input,
      this.#context.maxAmount,
      this.#context.customer,
      settlementOrderId,
    );

    const result = await this.#context.http.request<unknown>({
      method: 'POST',
      path,
      auth,
      // `tx_ref` is the provider's de-duplication key, so a retried write is safe.
      retryableWrite: true,
      body: prepared.body,
      ...transportOverrides(options),
    });

    return toInitiation(prepared, result.data);
  }

  async #fetchVerified(
    path: string,
    requestedReference: string,
    options: RequestOptions | undefined,
  ): Promise<VerifiedPayment> {
    const result = await this.#context.http.request<unknown>({
      method: 'GET',
      path,
      auth: 'public',
      ...transportOverrides(options),
    });

    return toVerifiedPayment(result.data, requestedReference);
  }
}

/** Validates every caller value, then assembles the wire body. */
function prepareInitiation(
  input: InitiatePaymentInput,
  maxAmount: number | undefined,
  customerPolicy: ResourceContext['customer'],
  settlementOrderId: string | undefined,
): PreparedInitiation {
  const policy: NonNullable<ResourceContext['customer']> = customerPolicy ?? {
    sanitizeName: true,
    requireEmail: true,
    emailFallbackDomain: undefined,
  };
  // `toApiAmount` also validates the amount; the guardrail runs after so the
  // reported ceiling is the caller's, not the provider's.
  const amount = toApiAmount(input.amount, 'amount');

  if (maxAmount !== undefined && input.amount > maxAmount) {
    throw new MyImoPayValidationError(
      `amount ${input.amount} exceeds the configured maxAmount ${maxAmount}. ` +
        'Raise maxAmount or initiate a smaller payment.',
      'amount',
    );
  }

  const customer = input.customer;
  if (customer === null || typeof customer !== 'object') {
    throw new MyImoPayValidationError(
      'customer must be an object carrying fullName and mobile.',
      'customer',
    );
  }

  const reference =
    input.reference === undefined
      ? createReference()
      : assertReference(input.reference, 'reference');
  const currency = normalizeCurrency(input.currency);

  const body: Record<string, string> = {};
  // The wire names live in `WIRE` because the naming lint rejects snake_case
  // literals while `noPropertyAccessFromIndexSignature` rejects dot access.
  body[WIRE.txRef] = reference;
  body[WIRE.amount] = amount;
  body[WIRE.currency] = currency;
  const mobile = assertPhone(customer.mobile, 'customer.mobile');
  const rawName = assertNonEmptyString(customer.fullName, 'customer.fullName');

  // The provider rejects punctuation, lone one-letter words and single-word
  // names, so normalisation is on by default and can be switched off by a
  // caller that already produces acceptable values.
  body[WIRE.fullName] = policy.sanitizeName
    ? sanitizeCustomerName(rawName)
    : rawName.replace(/\s+/g, ' ');
  body[WIRE.mobile] = mobile;

  const email = resolveEmail(customer.email, mobile, policy);
  if (email !== undefined) body[WIRE.email] = email;

  if (input.callbackUrl !== undefined) {
    body[WIRE.callbackUrl] = assertHttpsUrl(input.callbackUrl, 'callbackUrl');
  }

  if (settlementOrderId !== undefined) {
    body[WIRE.settlementOrderId] = settlementOrderId;
  }

  return { reference, amount: input.amount, currency, body };
}

/**
 * The provider schema says `customer_email` is optional, but in practice an
 * initiation without one is rejected. The default is therefore "required",
 * with two explicit escapes: derive it from the phone, or turn the requirement
 * off once the caller has verified its own flow.
 */
function resolveEmail(
  value: unknown,
  mobile: string,
  policy: { requireEmail: boolean; emailFallbackDomain: string | undefined },
): string | undefined {
  const email = normalizeCustomerEmail(value);

  if (email !== undefined) return email;
  if (policy.emailFallbackDomain !== undefined) {
    return deriveEmailFromPhone(mobile, policy.emailFallbackDomain);
  }
  if (policy.requireEmail) {
    throw new MyImoPayValidationError(
      'customer.email is required: MyIMO Pay rejects initiations without one in practice. ' +
        'Pass customer.email, set customer.emailFallbackDomain to derive one from the phone, ' +
        'or set customer.requireEmail to false if you have verified your flow needs none.',
      'customer.email',
    );
  }

  return undefined;
}

function toInitiation(prepared: PreparedInitiation, data: unknown): PaymentInitiation {
  const record = asRecord(data, 'initiation');

  // A 200 without a checkout link is a provider contract break: the payer
  // cannot be sent anywhere, so pretending the initiation succeeded loses money.
  const link = readNonEmptyString(record, 'payment_link');
  if (link === null) {
    throw new MyImoPayError({
      code: 'MALFORMED_RESPONSE',
      message:
        'The provider accepted the payment but returned no payment_link; the payer cannot be sent to checkout.',
    });
  }

  const providerReference = readNonEmptyString(record, 'tx_reference');

  return {
    reference: prepared.reference,
    providerReference: providerReference ?? prepared.reference,
    authorizationUrl: link,
    expiresAt:
      parseDate(readField(record, 'expires_on')) ?? new Date(Date.now() + DEFAULT_EXPIRY_MS),
    amount: prepared.amount,
    currency: prepared.currency,
    raw: record,
  };
}

function toVerifiedPayment(data: unknown, requestedReference: string): VerifiedPayment {
  const record = asRecord(data, 'verification');

  const isSettled = readBoolean(readField(record, 'is_settled'));
  const status = mapPaymentStatus(readNumeric(record, 'status'), isSettled);
  const paid = readNumeric(record, 'paid_amount');
  const charged = readNumeric(record, 'charged_amount');

  return {
    reference: readNonEmptyString(record, 'tx_reference') ?? requestedReference,
    providerReference: readNonEmptyString(record, 'provider_reference'),
    status,
    rawStatus: toRawStatus(readNumeric(record, 'status')),
    isSettled,
    currency: normalizeCurrency(readNonEmptyString(record, 'currency') ?? undefined),
    amountInitial: toNumberOr(readNumeric(record, 'initial_amount'), 'initial_amount', 0),
    // The provider uses both fields for "what the payer actually paid" depending
    // on the route; either one alone is enough to model the amount.
    amountPaid: toNumberOr(paid ?? charged, 'paid_amount', 0),
    amountCharged: toNumberOr(charged ?? paid, 'charged_amount', 0),
    amountPayout: toNumberOr(readNumeric(record, 'payout_amount'), 'payout_amount', 0),
    chargeBearer: mapChargeBearer(readNumeric(record, 'charge_bearer')),
    isSplit: readBoolean(readField(record, 'is_split')),
    settlementOrderId: readNonEmptyString(record, 'settlement_order_id'),
    expiresAt: parseDate(readField(record, 'expiration_time')),
    raw: record,
  };
}

/** Copies only the caller's overrides, so `exactOptionalPropertyTypes` stays honest. */
function transportOverrides(
  options: RequestOptions | undefined,
): Pick<HttpRequestOptions, 'baseUrl' | 'headers' | 'signal' | 'timeoutMs'> {
  const overrides: Pick<HttpRequestOptions, 'baseUrl' | 'headers' | 'signal' | 'timeoutMs'> = {};
  if (options === undefined) return overrides;

  if (options.baseUrl !== undefined) overrides.baseUrl = options.baseUrl;
  if (options.headers !== undefined) overrides.headers = options.headers;
  if (options.signal !== undefined) overrides.signal = options.signal;
  if (options.timeoutMs !== undefined) overrides.timeoutMs = options.timeoutMs;

  return overrides;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new MyImoPayError({
    code: 'MALFORMED_RESPONSE',
    message: `The provider returned a ${context} payload the SDK could not read.`,
  });
}

/**
 * Reads a provider field. Going through a variable rather than a literal keeps
 * the snake_case wire names out of the property-access rules.
 */
function readField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function readNumeric(record: Record<string, unknown>, key: string): Numeric | null {
  const value = readField(record, key);
  if (typeof value === 'number' || typeof value === 'string') return value;
  return null;
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string | null {
  const value = readField(record, key);
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

function toRawStatus(value: Numeric | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Dates arrive as ISO strings; anything unparseable becomes `null`, never `Invalid Date`. */
function parseDate(value: unknown): Date | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value) : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const millis = Date.parse(trimmed);
  return Number.isNaN(millis) ? null : new Date(millis);
}
