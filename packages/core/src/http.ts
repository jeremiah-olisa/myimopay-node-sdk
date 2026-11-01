// @sdk-implemented-by: F1-transport

import {
  isMyImoPayError,
  MyImoPayApiError,
  MyImoPayError,
  type MyImoPayErrorCode,
  MyImoPayNetworkError,
  MyImoPayTimeoutError,
  MyImoPayValidationError,
} from './errors';
import type { ApiResult, ResponseHeader } from './types/common';
import type {
  FetchResponseLike,
  HttpConfig,
  HttpRequestOptions,
  RequestInitLike,
  RetryConfig,
} from './types/config';
import type { DebugEvent } from './types/debug';
import { redact } from './utils/redact';
import { buildQuery, joinUrl } from './utils/url';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_RETRY_AFTER_MS = 300_000;
const JITTER_MS = 100;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);
const REQUEST_ID_HEADERS = ['x-request-id', 'x-trace-id', 'x-correlation-id'] as const;
const ALREADY_COMPLETED_REMARKS = ['already completed'] as const;
const DUPLICATE_REMARKS = ['already initiated', 'duplicate', 'already exists'] as const;

interface AttemptOutcome {
  status: number;
  parsed: unknown;
  response: FetchResponseLike;
}

type DebugExtras = Partial<Pick<DebugEvent, 'status' | 'durationMs' | 'message'>>;

/**
 * The single transport used by every resource.
 *
 * Responsibilities (and nobody else's): URL building, authentication headers,
 * timeouts, retries with backoff, envelope unwrapping, status → error mapping.
 * Resources never construct URLs or interpret HTTP status codes.
 */
export class HttpClient {
  protected readonly config: HttpConfig;

  constructor(config: HttpConfig) {
    this.config = config;
  }

  /** Exposed for tests and for advanced callers that need a raw provider call. */
  get httpConfig(): HttpConfig {
    return this.config;
  }

  async request<T>(options: HttpRequestOptions): Promise<ApiResult<T>> {
    const method = options.method;
    const baseUrl = this.resolveBaseUrl(options.baseUrl);
    const queryString = options.query === undefined ? '' : buildQuery(options.query);
    const path = queryString === '' ? options.path : `${options.path}?${queryString}`;
    const url = joinUrl(baseUrl, path);
    const headers = this.buildHeaders(options);
    const body = options.body === undefined ? undefined : this.serializeBody(options.body);
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const maxAttempts = Math.max(1, Math.trunc(this.config.retry.attempts));
    const mayRetry = method === 'GET' || options.retryableWrite === true;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      this.emitDebug('request', method, path, attempt);

      let outcome: AttemptOutcome;
      try {
        outcome = await this.perform(url, method, headers, body, timeoutMs, options.signal);
      } catch (error) {
        if (isRetryableFailure(error) && mayRetry && attempt < maxAttempts) {
          this.emitDebug('retry', method, path, attempt, {
            message: describeFailure(error),
          });
          await wait(retryDelayMs(attempt, null, this.config.retry), options.signal);
          continue;
        }
        this.emitDebug('error', method, path, attempt, {
          durationMs: Date.now() - startedAt,
          message: describeFailure(error),
        });
        throw error;
      }

      this.emitDebug('response', method, path, attempt, {
        status: outcome.status,
        durationMs: Date.now() - startedAt,
      });

      if (outcome.status < 200 || outcome.status >= 300) {
        const remark = readRemark(readEnvelope(outcome.parsed).header);

        if (RETRYABLE_STATUSES.has(outcome.status) && mayRetry && attempt < maxAttempts) {
          this.emitDebug('retry', method, path, attempt, { status: outcome.status });
          const retryAfter = parseRetryAfter(outcome.response);
          await wait(retryDelayMs(attempt, retryAfter, this.config.retry), options.signal);
          continue;
        }

        const error = new MyImoPayApiError({
          code: mapStatus(outcome.status, remark),
          message: statusMessage(outcome.status, remark),
          status: outcome.status,
          remark,
          requestId: readRequestId(outcome.response),
          body: redact(outcome.parsed),
        });
        this.emitDebug('error', method, path, attempt, {
          status: outcome.status,
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }

      try {
        return this.unwrap<T>(outcome);
      } catch (error) {
        this.emitDebug('error', method, path, attempt, {
          status: outcome.status,
          durationMs: Date.now() - startedAt,
          message: describeFailure(error),
        });
        throw error;
      }
    }

    // Unreachable: every loop iteration returns or throws.
    throw new MyImoPayError({
      code: 'UNKNOWN',
      message: 'The request exhausted its retry budget without a result.',
    });
  }

  /** Performs one attempt: fetch, bounded body read, JSON parse. */
  private async perform(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<AttemptOutcome> {
    if (callerSignal?.aborted === true) throw abortError();

    const controller = new AbortController();
    let timedOut = false;
    let callerAborted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onCallerAbort = (): void => {
      callerAborted = true;
      controller.abort();
    };

    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          reject(timedOut ? new MyImoPayTimeoutError() : abortError());
        },
        { once: true },
      );
    });

    timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.max(0, timeoutMs),
    );

    if (callerSignal !== undefined) {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const work = this.runFetch(url, method, headers, body, controller.signal);
      const { response, text } = await Promise.race([work, aborted]);

      assertResponseSize(text);
      if (text.trim() === '') {
        throw malformedResponseError('The provider returned an empty response body.');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw malformedResponseError('The provider response body was not valid JSON.');
      }

      return { status: response.status, parsed, response };
    } catch (error) {
      if (error instanceof MyImoPayError) throw error;
      if (timedOut) throw new MyImoPayTimeoutError(undefined, error);
      if (callerAborted) throw abortError();
      throw new MyImoPayNetworkError(
        'The request to MyIMO Pay failed before a response was received.',
        error,
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (callerSignal !== undefined) callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }

  private async runFetch(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    signal: AbortSignal,
  ): Promise<{ response: FetchResponseLike; text: string }> {
    const init: RequestInitLike = { method, headers, signal, redirect: 'error' };
    if (body !== undefined) init.body = body;

    const response = await this.config.fetch(url, init);
    const text = await response.text();
    return { response, text };
  }

  /** Only https is ever acceptable; there is deliberately no insecure escape hatch. */
  private resolveBaseUrl(override: string | undefined): string {
    const baseUrl = override ?? this.config.baseUrl;
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
      throw new MyImoPayValidationError('A base URL is required for every request.', 'baseUrl');
    }

    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new MyImoPayValidationError(
        `The base URL "${baseUrl}" is not an absolute URL. Use an https URL, for example https://api.myimopay.com.`,
        'baseUrl',
      );
    }

    if (parsed.protocol !== 'https:') {
      throw new MyImoPayValidationError(
        `The MyIMO Pay API is only called over https; "${baseUrl}" uses "${parsed.protocol}". Pass an https base URL instead — there is no insecure mode.`,
        'baseUrl',
      );
    }

    return baseUrl;
  }

  private buildHeaders(options: HttpRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'user-agent': this.config.userAgent,
      accept: 'application/json',
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    const isReserved = (name: string): boolean => this.isAuthHeaderName(name);
    applyHeaders(headers, options.headers, isReserved);
    applyHeaders(headers, this.config.headers, isReserved);

    const auth = options.auth ?? 'public';
    if (auth === 'public' || auth === 'secret') {
      headers[this.config.publicKeyHeader] = this.config.publicKey;
    }
    if (auth === 'secret') {
      const secretKey = this.config.secretKey;
      if (secretKey === undefined || secretKey === '') {
        throw invalidConfigError(
          "auth: 'secret' requires config.secretKey. Provide the secret key or use auth: 'public'.",
        );
      }
      headers[this.config.secretKeyHeader] = secretKey;
    }

    return headers;
  }

  private isAuthHeaderName(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower === this.config.publicKeyHeader.toLowerCase() ||
      lower === this.config.secretKeyHeader.toLowerCase()
    );
  }

  private serializeBody(body: unknown): string {
    try {
      const serialized = JSON.stringify(body);
      if (serialized === undefined) {
        throw new MyImoPayValidationError(
          'The request body could not be serialised to JSON.',
          'body',
        );
      }
      return serialized;
    } catch (error) {
      if (error instanceof MyImoPayValidationError) throw error;
      throw new MyImoPayValidationError(
        'The request body could not be serialised to JSON.',
        'body',
      );
    }
  }

  /** Unwraps `{ header, data }` for a 2xx response. */
  private unwrap<T>(outcome: AttemptOutcome): ApiResult<T> {
    const envelope = readEnvelope(outcome.parsed);
    const remark = readRemark(envelope.header);

    if (!envelope.isSuccess) {
      throw new MyImoPayApiError({
        code: mapRemarkCode(remark),
        message: statusMessage(outcome.status, remark),
        status: outcome.status,
        remark,
        requestId: readRequestId(outcome.response),
        body: redact(outcome.parsed),
      });
    }

    if (envelope.data === null || envelope.data === undefined) {
      throw malformedResponseError(
        'The provider returned a successful response without a data payload.',
      );
    }

    return {
      data: envelope.data as T,
      header: normalizeHeader(envelope.header),
      status: outcome.status,
      raw: outcome.parsed,
    };
  }

  private emitDebug(
    type: DebugEvent['type'],
    method: string,
    path: string,
    attempt: number,
    extras: DebugExtras = {},
  ): void {
    const onDebug = this.config.onDebug;
    if (onDebug === undefined) return;

    const event: DebugEvent = { type, method, path, attempt };
    if (extras.status !== undefined) event.status = extras.status;
    if (extras.durationMs !== undefined) event.durationMs = extras.durationMs;
    if (extras.message !== undefined) {
      const message = redact(extras.message);
      event.message = typeof message === 'string' ? message : 'The request failed.';
    }

    try {
      onDebug(event);
    } catch {
      // A diagnostics hook must never break a live payment.
    }
  }
}

interface Envelope {
  header: Record<string, unknown> | null;
  data: unknown;
  isSuccess: boolean;
}

function readEnvelope(parsed: unknown): Envelope {
  if (!isRecord(parsed)) {
    return { header: null, data: undefined, isSuccess: true };
  }
  const headerValue = readField(parsed, 'header');
  const header = isRecord(headerValue) ? headerValue : null;
  const isSuccess = header === null || readField(header, 'is_success') !== false;
  return { header, data: readField(parsed, 'data'), isSuccess };
}

function normalizeHeader(header: Record<string, unknown> | null): ResponseHeader {
  if (header === null) {
    return { isSuccess: true, status: null, remark: null, timeStamp: null };
  }
  return {
    isSuccess: readField(header, 'is_success') !== false,
    status: readString(readField(header, 'status')),
    remark: readRemark(header),
    timeStamp: readNumber(readField(header, 'time_stamp')),
  };
}

function readRemark(header: Record<string, unknown> | null): string | null {
  if (header === null) return null;
  const remark =
    readString(readField(header, 'remark')) ?? readString(readField(header, 'message'));
  if (remark === null) return null;
  const trimmed = remark.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Reads a provider field by name. Access through a variable rather than a
 * literal keeps the biome naming/literal-key rules and `noPropertyAccessFromIndexSignature`
 * from fighting each other over the snake_case wire format.
 */
function readField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readRequestId(response: FetchResponseLike): string | null {
  for (const name of REQUEST_ID_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null && value.trim() !== '') return value.trim();
  }
  return null;
}

function matchesRemark(remark: string | null, needles: readonly string[]): boolean {
  if (remark === null) return false;
  const lower = remark.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function mapRemarkCode(remark: string | null): MyImoPayErrorCode {
  if (matchesRemark(remark, ALREADY_COMPLETED_REMARKS)) return 'ALREADY_COMPLETED';
  if (matchesRemark(remark, DUPLICATE_REMARKS)) return 'DUPLICATE_REFERENCE';
  return 'PROVIDER_ERROR';
}

function mapStatus(status: number, remark: string | null): MyImoPayErrorCode {
  if (status === 400) {
    const code = mapRemarkCode(remark);
    return code === 'PROVIDER_ERROR' ? 'VALIDATION_ERROR' : code;
  }
  switch (status) {
    case 401:
    case 403:
      return 'INVALID_API_KEY';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 412:
      return 'MISSING_API_KEY';
    case 422:
      return 'MERCHANT_NOT_READY';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'PROVIDER_ERROR';
  }
}

function statusMessage(status: number, remark: string | null): string {
  if (remark !== null) return remark;
  return `The provider request failed with HTTP status ${status}.`;
}

function parseRetryAfter(response: FetchResponseLike): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

function retryDelayMs(
  attempt: number,
  retryAfterSeconds: number | null,
  retry: Required<RetryConfig>,
): number {
  // `maxDelayMs` is the hard ceiling for any wait, including a provider-
  // requested `retry-after`; the latter is additionally capped at 5 minutes.
  const ceiling = Math.max(0, retry.maxDelayMs);
  if (retryAfterSeconds !== null) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS, ceiling);
  }
  const exponential = Math.max(0, retry.baseDelayMs) * 2 ** (attempt - 1);
  const jitter = Math.random() * JITTER_MS;
  return Math.min(exponential + jitter, ceiling);
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortError());

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      reject(abortError());
    };

    timer = setTimeout(() => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function applyHeaders(
  target: Record<string, string>,
  source: Record<string, string> | undefined,
  isReserved: (name: string) => boolean,
): void {
  if (source === undefined) return;
  for (const [name, value] of Object.entries(source)) {
    if (isReserved(name)) continue;
    target[name] = value;
  }
}

function assertResponseSize(text: string): void {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_RESPONSE_BYTES) {
    throw malformedResponseError(
      `The provider response exceeded the ${MAX_RESPONSE_BYTES} byte limit.`,
    );
  }
}

function isRetryableFailure(error: unknown): boolean {
  if (error instanceof MyImoPayTimeoutError) return true;
  if (error instanceof MyImoPayNetworkError) return error.code === 'NETWORK_ERROR';
  return false;
}

function describeFailure(error: unknown): string {
  const message = isMyImoPayError(error)
    ? error.message
    : 'The request failed before a response was received.';
  const scrubbed = redact(message);
  return typeof scrubbed === 'string' ? scrubbed : 'The request failed.';
}

function abortError(): MyImoPayError {
  return new MyImoPayError({
    code: 'ABORTED',
    message: 'The request was aborted before it completed.',
  });
}

function invalidConfigError(message: string): MyImoPayError {
  return new MyImoPayError({ code: 'INVALID_CONFIG', message });
}

function malformedResponseError(message: string): MyImoPayError {
  return new MyImoPayError({ code: 'MALFORMED_RESPONSE', message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
