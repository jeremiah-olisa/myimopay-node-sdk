// @sdk-owner: A0-contracts
// @sdk-phase: 1
// @sdk-implemented-by: F3-assembly

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Numeric, PaymentStatus } from '@myimopay/core';
import { MyImoPayWebhookError, mapPaymentStatus, toNumberOr } from '@myimopay/core';

/**
 * The normalised shape of a provider webhook delivery.
 *
 * MyIMO Pay does not sign webhooks, so `raw` is the provider payload exactly as
 * parsed from the raw body. Every field here is a projection of it, which means
 * `constructEvent` never invents a status the provider did not send.
 */
export interface WebhookEvent {
  /** The merchant `tx_ref` the delivery is about. */
  reference: string;
  /** Provider-side reference, when the payload carries one. */
  providerReference: string | null;
  status: PaymentStatus;
  /** Provider integer status, kept for support tickets. */
  rawStatus: number | null;
  /** `data.is_settled` — the strongest signal the provider exposes. */
  isSettled: boolean;
  amountPaid: number;
  currency: string;
  /** Delivery identifier, when present. Used for de-duplication. */
  eventId: string | null;
  /** Provider payload, untouched. */
  raw: unknown;
}

/** What `constructEvent` needs in order to authenticate a delivery. */
export interface WebhookOptions {
  /**
   * Shared secret used for the HMAC both production integrations verify with.
   * This is the merchant's own secret, not a provider-issued webhook key.
   */
  secret: string;
  /** Header carrying the hex digest. Default `x-myimopay-signature`. */
  headerName?: string;
}

/** A lower-case SHA-256 digest, hex-encoded. Exactly what `signWebhookPayload` emits. */
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

const DEFAULT_CURRENCY = 'NGN';

const SIGNATURE_INVALID_MESSAGE =
  'Webhook signature verification failed. Compute an HMAC-SHA256 hex digest over the raw request body with the shared secret, read the body before JSON parsing (readRawBody, or `await req.text()`), and pass the digest header (default "x-myimopay-signature") to constructEvent.';

function hmacHex(rawBody: string | Uint8Array, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time check of an HMAC-SHA256 hex digest over the raw request body.
 *
 * Returns `false` for a missing, malformed or mismatched signature; never
 * throws, so a caller can answer `401` without branching on error types.
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (typeof secret !== 'string' || secret.trim() === '') return false;
  if (typeof signature !== 'string') return false;

  const candidate = signature.trim().toLowerCase();

  if (candidate === '' || !SIGNATURE_PATTERN.test(candidate)) return false;
  if (typeof rawBody !== 'string' && !(rawBody instanceof Uint8Array)) return false;
  if (rawBody.length === 0) return false;

  const expected = Buffer.from(hmacHex(rawBody, secret), 'hex');
  const received = Buffer.from(candidate, 'hex');

  // Both are 32 bytes because of SIGNATURE_PATTERN, but timingSafeEqual throws
  // on a length mismatch, so check rather than trust the pattern.
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}

/**
 * Verifies the delivery and projects it into a `WebhookEvent`.
 *
 * Throws `MyImoPayWebhookError` when the signature does not match — an
 * unverified delivery must never be parsed into an event. An empty
 * `options.secret` is rejected too: the provider sends unsigned deliveries, so
 * accepting one "because there is nothing to check" would let anyone post a
 * payment success.
 */
export function constructEvent(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  options: WebhookOptions,
): WebhookEvent {
  const supplied: { secret?: unknown; headerName?: unknown } = options;
  const secret = supplied.secret;

  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new MyImoPayWebhookError(
      'WebhookOptions.secret is required: MyIMO Pay sends unsigned deliveries, so the SDK authenticates every webhook with the shared HMAC secret. An empty secret would accept any delivery, including a forged payment success.',
    );
  }

  if (
    supplied.headerName !== undefined &&
    (typeof supplied.headerName !== 'string' || supplied.headerName.trim() === '')
  ) {
    throw new MyImoPayWebhookError(
      'WebhookOptions.headerName must be a non-empty string naming the header that carries the hex digest (default "x-myimopay-signature").',
    );
  }

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    throw new MyImoPayWebhookError(SIGNATURE_INVALID_MESSAGE);
  }

  const parsed = parseRawBody(rawBody);
  const body = unwrapPayload(parsed);
  const reference = readString(body, ['tx_reference', 'tx_ref', 'reference']);

  if (reference === null) {
    throw new MyImoPayWebhookError(
      'Webhook payload has no transaction reference: expected `tx_reference` (or `tx_ref`) in the delivery body. Verify the payload shape against a real delivery before granting value.',
    );
  }

  const isSettled = readBoolean(body, ['is_settled']);
  const rawStatus = readStatus(body);

  return {
    reference,
    providerReference: readString(body, ['provider_reference']),
    status: mapPaymentStatus(rawStatus, isSettled),
    rawStatus,
    isSettled,
    amountPaid: toNumberOr(readNumeric(body, ['paid_amount', 'charged_amount']), 'paid_amount', 0),
    currency: readString(body, ['currency'])?.toUpperCase() ?? DEFAULT_CURRENCY,
    eventId: readString(body, ['id', 'identifier']),
    raw: parsed,
  };
}

/** The digest `verifyWebhookSignature` expects, for tests and local replay. */
export function signWebhookPayload(rawBody: string, secret: string): string {
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new MyImoPayWebhookError(
      'Cannot sign a webhook payload without a secret: an HMAC keyed with an empty string is reproducible by anyone. Pass the shared secret you verify deliveries with.',
    );
  }

  if (typeof rawBody !== 'string') {
    throw new MyImoPayWebhookError('signWebhookPayload expects the raw request body as a string.');
  }

  return hmacHex(rawBody, secret);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRawBody(rawBody: string | Uint8Array): unknown {
  const text = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);

  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new MyImoPayWebhookError(
      'Webhook body is not valid JSON. Pass the raw request body exactly as received — readRawBody(stream), or `await req.text()` in a Next.js route handler — and never re-serialise a parsed object.',
    );
  }
}

/** Both delivery shapes exist in the wild: an `{ header, data }` envelope and a bare payload. */
interface Envelope {
  readonly data?: unknown;
}

/**
 * Uses `data` when the delivery is an envelope and the root otherwise.
 *
 * The cast is narrow: `isRecord` has already proved the value is a plain
 * object, and `Envelope` only renames the field so the index signature does not
 * force bracket access (which the linter rejects in favour of dot access).
 */
function unwrapPayload(parsed: unknown): Record<string, unknown> {
  if (!isRecord(parsed)) {
    throw new MyImoPayWebhookError(
      'Webhook payload must be a JSON object. Check the delivery and the endpoint that received it.',
    );
  }

  const envelope: Envelope = parsed;

  if (isRecord(envelope.data)) return envelope.data;

  return parsed;
}

function readString(body: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = body[key];

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') return trimmed;
    }

    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }

  return null;
}

function readNumeric(body: Record<string, unknown>, keys: readonly string[]): Numeric | null {
  for (const key of keys) {
    const value = body[key];

    if (typeof value === 'number' || typeof value === 'string') return value;
  }

  return null;
}

/** Provider flags arrive as booleans, 0/1, or the strings `"true"`/`"false"`. */
function readBoolean(body: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = body[key];

    if (value === true || value === 1 || value === 'true' || value === '1') return true;
    if (value === false || value === 0 || value === 'false' || value === '0') return false;
  }

  return false;
}

/**
 * The provider's integer status, when it sent one.
 *
 * `mapPaymentStatus` is non-throwing, so a status that arrived as free text
 * must not fail the delivery here either: it becomes `null`, which maps to
 * `unknown` like any other status the SDK does not recognise.
 */
function readStatus(body: Record<string, unknown>): number | null {
  const value = readNumeric(body, ['status']);

  if (value === null) return null;

  try {
    const status = toNumberOr(value, 'status', Number.NaN);

    return Number.isFinite(status) ? status : null;
  } catch {
    return null;
  }
}
