/**
 * One error hierarchy for every failure mode. No thrown value in this SDK is
 * ever a bare string, an Axios error, or a provider payload.
 */

export type MyImoPayErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CONFIG'
  | 'INVALID_API_KEY'
  | 'MISSING_API_KEY'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_REFERENCE'
  | 'ALREADY_COMPLETED'
  | 'MERCHANT_NOT_READY'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'ABORTED'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'SERVER_ONLY'
  | 'UNKNOWN';

export interface MyImoPayErrorOptions {
  code: MyImoPayErrorCode;
  message: string;
  cause?: unknown;
}

/** Base class. Always use `isMyImoPayError` rather than `instanceof` across package copies. */
export class MyImoPayError extends Error {
  readonly code: MyImoPayErrorCode;

  constructor(options: MyImoPayErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MyImoPayError';
    this.code = options.code;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Safe to log: never contains credentials. */
  toJSON(): { name: string; code: MyImoPayErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

/** Thrown before any network call: the caller's input is unusable. */
export class MyImoPayValidationError extends MyImoPayError {
  readonly field: string | null;

  constructor(message: string, field?: string) {
    super({ code: 'VALIDATION_ERROR', message });
    this.name = 'MyImoPayValidationError';
    this.field = field ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface MyImoPayApiErrorOptions extends MyImoPayErrorOptions {
  status: number;
  remark?: string | null;
  requestId?: string | null;
  body?: unknown;
}

/** The provider answered, and the answer was a failure. */
export class MyImoPayApiError extends MyImoPayError {
  readonly status: number;
  readonly remark: string | null;
  readonly requestId: string | null;
  readonly body: unknown;

  constructor(options: MyImoPayApiErrorOptions) {
    super(options);
    this.name = 'MyImoPayApiError';
    this.status = options.status;
    this.remark = options.remark ?? null;
    this.requestId = options.requestId ?? null;
    this.body = options.body;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  override toJSON(): {
    name: string;
    code: MyImoPayErrorCode;
    message: string;
    status: number;
    remark: string | null;
    requestId: string | null;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      remark: this.remark,
      requestId: this.requestId,
    };
  }
}

/** Transport-level failure: DNS, connection reset, TLS. */
export class MyImoPayNetworkError extends MyImoPayError {
  constructor(message: string, cause?: unknown, code: MyImoPayErrorCode = 'NETWORK_ERROR') {
    super({ code, message, cause });
    this.name = 'MyImoPayNetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The request exceeded `timeoutMs`. Safe to retry idempotent calls. */
export class MyImoPayTimeoutError extends MyImoPayNetworkError {
  constructor(message = 'The request to MyIMO Pay timed out.', cause?: unknown) {
    super(message, cause, 'TIMEOUT_ERROR');
    this.name = 'MyImoPayTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A webhook delivery could not be authenticated. Never process the payload. */
export class MyImoPayWebhookError extends MyImoPayError {
  constructor(message: string) {
    super({ code: 'WEBHOOK_SIGNATURE_INVALID', message });
    this.name = 'MyImoPayWebhookError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Works across duplicate copies of this package in a dependency tree, where
 * `instanceof` produces false negatives.
 */
export function isMyImoPayError(value: unknown): value is MyImoPayError {
  if (value instanceof MyImoPayError) return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string' &&
    (value as { name: string }).name.startsWith('MyImoPay')
  );
}
