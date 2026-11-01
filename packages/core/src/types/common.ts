/**
 * Types shared by every MyIMO Pay resource and by both published packages.
 *
 * The wire format is snake_case with numeric fields serialised as either a
 * number or a numeric string; the SDK normalises all of that into the
 * camelCase, number-typed models exported here. `raw` keeps the untouched
 * provider payload on every result so callers can reach fields the SDK does
 * not model yet.
 */

/** Provider environment. Staging still moves real money. */
export type Environment = 'staging' | 'live';

/** ISO-4217 code. MyIMO Pay currently settles NGN only. */
export type Currency = string;

/** Major units (₦50.50 → 50.5). Never minor units, never a string. */
export type Amount = number;

/** Numeric value as the provider may return it. */
export type Numeric = number | string;

/** Response header exactly as the provider sends it. */
export interface WireHeader {
  is_success?: boolean;
  status?: string | null;
  remark?: string | null;
  message?: string | null;
  encryption_type?: Numeric | null;
  time_stamp?: Numeric | null;
}

/** Every provider response is this envelope. */
export interface WireEnvelope<T> {
  header?: WireHeader | null;
  data?: T | null;
}

/** Response header after normalisation. */
export interface ResponseHeader {
  isSuccess: boolean;
  status: string | null;
  remark: string | null;
  timeStamp: number | null;
}

/** Normalised provider envelope; `data` is never null for successful calls. */
export interface ApiResult<T> {
  data: T;
  header: ResponseHeader;
  /** HTTP status of the final attempt. */
  status: number;
  /** Untouched parsed provider body. */
  raw: unknown;
}

/**
 * Payment status as the SDK reports it.
 *
 * Provider integers: `0 initiated`, `1 pending`, `2 success`, `3 failed`,
 * `4 expired`. `is_settled: true` always wins over the integer.
 */
export type PaymentStatus =
  | 'initiated'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'unknown';

/** Who pays the transaction charge. Provider integers: 1 merchant, 2 customer, 3 split. */
export type ChargeBearer = 'merchant' | 'customer' | 'split';

/** True for statuses that must never be reconciled again. */
export type TerminalPaymentStatus = 'succeeded' | 'failed' | 'expired';
