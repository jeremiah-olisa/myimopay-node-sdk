// @sdk-implemented-by: F1-transport

import { describe, expect, it } from 'bun:test';
import type { MyImoPayErrorCode } from '@core/errors';
import { MyImoPayApiError, MyImoPayError, MyImoPayTimeoutError } from '@core/errors';
import { HttpClient } from '@core/http';
import type { FetchLike, FetchResponseLike, HttpConfig, RequestInitLike } from '@core/types/config';
import type { DebugEvent } from '@core/types/debug';

const PUBLIC_KEY = 'pk_live_public_0123456789';
const SECRET_KEY = 'sk_live_secret_0123456789';
const BASE_URL = 'https://api.myimopay.test';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInitLike | undefined;
}

type Handler = (
  call: RecordedCall,
  index: number,
) => FetchResponseLike | Promise<FetchResponseLike>;

function recordingFetch(handler: Handler): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: RecordedCall = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch, calls };
}

function responseOf(
  text: string,
  status = 200,
  headers: Record<string, string> = {},
): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
    text: async () => text,
  };
}

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): FetchResponseLike {
  return responseOf(JSON.stringify(payload), status, headers);
}

function successEnvelope(data: unknown): unknown {
  return {
    header: {
      ['is_success']: true,
      status: 'success',
      remark: null,
      ['time_stamp']: 1_700_000_000,
    },
    data,
  };
}

function failureEnvelope(remark: string): unknown {
  return { header: { ['is_success']: false, status: 'failed', remark }, data: null };
}

function configWith(overrides: Partial<HttpConfig>): HttpConfig {
  return {
    baseUrl: BASE_URL,
    publicKey: PUBLIC_KEY,
    secretKey: SECRET_KEY,
    publicKeyHeader: 'xp-key',
    secretKeyHeader: 'sp-key',
    timeoutMs: 1000,
    retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 5 },
    headers: {},
    fetch: async () => {
      throw new Error('fetch was not stubbed');
    },
    userAgent: 'myimopay-test/1.0',
    ...overrides,
  };
}

function configWithoutSecretKey(overrides: Partial<HttpConfig> = {}): HttpConfig {
  const config = configWith(overrides);
  delete config.secretKey;
  return config;
}

function headerOf(call: RecordedCall | undefined, name: string): string | undefined {
  return call?.init?.headers?.[name];
}

async function captureError(run: Promise<unknown>): Promise<MyImoPayError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof MyImoPayError) return error;
    throw error;
  }
  throw new Error('expected the request to reject');
}

describe('HttpClient URL building', () => {
  it('builds URL and query from the configured base', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    await client.request({
      method: 'GET',
      path: '/vi/pay/verify',
      query: { ['tx_ref']: 'abc 123', page: 2, live: true, skip: undefined },
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(
      'https://api.myimopay.test/vi/pay/verify?tx_ref=abc%20123&page=2&live=true',
    );
  });

  it('honours a per-call baseUrl override', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    await client.request({ method: 'GET', path: '/health', baseUrl: 'https://proxy.test/' });

    expect(calls[0]?.url).toBe('https://proxy.test/health');
  });

  it('rejects an http base URL before any network call', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(
      client.request({ method: 'GET', path: '/health', baseUrl: 'http://insecure.test' }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('https');
    expect(calls.length).toBe(0);
  });

  it('rejects a non-absolute base URL before any network call', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ baseUrl: 'not-a-url', fetch }));

    const error = await captureError(client.request({ method: 'GET', path: '/health' }));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(calls.length).toBe(0);
  });
});

describe('HttpClient headers and auth', () => {
  it('sends default headers and only the public key for public auth', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    await client.request({ method: 'GET', path: '/vi/pay/verify' });

    const call = calls[0];
    expect(headerOf(call, 'user-agent')).toBe('myimopay-test/1.0');
    expect(headerOf(call, 'accept')).toBe('application/json');
    expect(headerOf(call, 'content-type')).toBeUndefined();
    expect(headerOf(call, 'xp-key')).toBe(PUBLIC_KEY);
    expect(headerOf(call, 'sp-key')).toBeUndefined();
  });

  it('sends both keys and a content-type when a body is present', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    await client.request({ method: 'POST', path: '/vi/pay/initiate', body: { amount: 100 } });

    const call = calls[0];
    expect(headerOf(call, 'xp-key')).toBe(PUBLIC_KEY);
    expect(headerOf(call, 'content-type')).toBe('application/json');
    expect(call?.init?.body).toBe('{"amount":100}');
  });

  it('sends both keys for secret auth', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    await client.request({ method: 'POST', path: '/vi/pay/initiate', body: {}, auth: 'secret' });

    expect(headerOf(calls[0], 'xp-key')).toBe(PUBLIC_KEY);
    expect(headerOf(calls[0], 'sp-key')).toBe(SECRET_KEY);
  });

  it('sends neither key for auth: none', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    await client.request({ method: 'GET', path: '/health', auth: 'none' });

    expect(headerOf(calls[0], 'xp-key')).toBeUndefined();
    expect(headerOf(calls[0], 'sp-key')).toBeUndefined();
  });

  it('fails with INVALID_CONFIG when secret auth has no secret key', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWithoutSecretKey({ fetch }));

    const error = await captureError(
      client.request({ method: 'GET', path: '/vi/entities/merchant/subaccounts', auth: 'secret' }),
    );

    expect(error.code).toBe('INVALID_CONFIG');
    expect(calls.length).toBe(0);
  });

  it('rejects a per-call credential header instead of silently dropping it', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(
      client.request({
        method: 'GET',
        path: '/vi/pay/verify',
        auth: 'secret',
        headers: { 'xp-key': 'attacker', 'sp-key': 'attacker' },
      }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(calls.length).toBe(0);
  });

  it('keeps non-reserved per-call headers', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    await client.request({
      method: 'GET',
      path: '/vi/pay/verify',
      auth: 'secret',
      headers: { 'x-extra': 'kept' },
    });

    expect(headerOf(calls[0], 'xp-key')).toBe(PUBLIC_KEY);
    expect(headerOf(calls[0], 'sp-key')).toBe(SECRET_KEY);
    expect(headerOf(calls[0], 'x-extra')).toBe('kept');
  });

  it('applies configured headers after per-call headers', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(
      configWith({ fetch, headers: { 'x-source': 'client', 'x-shared': 'client' } }),
    );

    await client.request({
      method: 'GET',
      path: '/health',
      headers: { 'x-shared': 'call' },
    });

    expect(headerOf(calls[0], 'x-source')).toBe('client');
    expect(headerOf(calls[0], 'x-shared')).toBe('client');
  });
});

describe('HttpClient success', () => {
  it('unwraps the envelope and preserves the raw payload', async () => {
    const payload = successEnvelope({ reference: 'ref_1', amount: 100 });
    const { fetch } = recordingFetch(() =>
      jsonResponse(payload, 200, { 'x-request-id': 'req_123' }),
    );
    const client = new HttpClient(configWith({ fetch }));

    const result = await client.request<{ reference: string; amount: number }>({
      method: 'GET',
      path: '/vi/pay/verify',
    });

    expect(result.data).toEqual({ reference: 'ref_1', amount: 100 });
    expect(result.raw).toEqual(payload);
    expect(result.status).toBe(200);
    expect(result.header).toEqual({
      isSuccess: true,
      status: 'success',
      remark: null,
      timeStamp: 1_700_000_000,
    });
  });

  it('sends redirect: error on every request', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(configWith({ fetch }));

    await client.request({ method: 'GET', path: '/health' });

    expect(calls[0]?.init?.redirect).toBe('error');
  });
});

describe('HttpClient error mapping', () => {
  it('maps a duplicate 400 to DUPLICATE_REFERENCE', async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(failureEnvelope('A duplicate reference was provided'), 400, {
        'x-request-id': 'req_dup',
      }),
    );
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'POST', path: '/vi/pay/initiate' }));

    expect(error).toBeInstanceOf(MyImoPayApiError);
    const apiError = error as MyImoPayApiError;
    expect(apiError.code).toBe('DUPLICATE_REFERENCE');
    expect(apiError.status).toBe(400);
    expect(apiError.remark).toBe('A duplicate reference was provided');
    expect(apiError.message).toBe('A duplicate reference was provided');
    expect(apiError.requestId).toBe('req_dup');
  });

  it('maps "already completed" to ALREADY_COMPLETED', async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(failureEnvelope('This payment has already completed'), 400),
    );
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'POST', path: '/vi/pay/initiate' }));

    expect(error.code).toBe('ALREADY_COMPLETED');
  });

  it('maps any other 400 to VALIDATION_ERROR', async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(failureEnvelope('amount must be positive'), 400),
    );
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'POST', path: '/vi/pay/initiate' }));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('amount must be positive');
  });

  const statusCases: readonly { status: number; code: MyImoPayErrorCode }[] = [
    { status: 401, code: 'INVALID_API_KEY' },
    { status: 403, code: 'INVALID_API_KEY' },
    { status: 404, code: 'NOT_FOUND' },
    { status: 409, code: 'CONFLICT' },
    { status: 412, code: 'MISSING_API_KEY' },
    { status: 422, code: 'MERCHANT_NOT_READY' },
    { status: 429, code: 'RATE_LIMITED' },
    { status: 500, code: 'PROVIDER_ERROR' },
    { status: 502, code: 'PROVIDER_ERROR' },
    { status: 418, code: 'PROVIDER_ERROR' },
  ];

  for (const { status, code } of statusCases) {
    it(`maps HTTP ${status} to ${code}`, async () => {
      const { fetch } = recordingFetch(() =>
        jsonResponse(failureEnvelope('provider said no'), status),
      );
      const client = new HttpClient(configWith({ fetch }));

      const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

      expect(error).toBeInstanceOf(MyImoPayApiError);
      expect(error.code).toBe(code);
      expect((error as MyImoPayApiError).status).toBe(status);
    });
  }

  it('falls back to a readable message when the provider gives no remark', async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse({ header: { ['is_success']: false }, data: null }, 500),
    );
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

    expect(error.message).toBe('The provider request failed with HTTP status 500.');
  });

  it('reads the request id from x-trace-id and x-correlation-id too', async () => {
    for (const header of ['x-trace-id', 'x-correlation-id']) {
      const { fetch } = recordingFetch(() =>
        jsonResponse(failureEnvelope('nope'), 404, { [header]: 'req_trace' }),
      );
      const client = new HttpClient(configWith({ fetch }));

      const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

      expect((error as MyImoPayApiError).requestId).toBe('req_trace');
    }
  });

  it('redacts secrets out of the error body', async () => {
    const payload = {
      header: { ['is_success']: false, remark: 'bad request' },
      data: {
        echoed: SECRET_KEY,
        nested: { 'xp-key': SECRET_KEY },
      },
    };
    const { fetch } = recordingFetch(() => jsonResponse(payload, 400));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'POST', path: '/vi/pay/initiate' }));

    expect(JSON.stringify(error)).not.toContain(SECRET_KEY);
    expect(JSON.stringify((error as MyImoPayApiError).body)).not.toContain(SECRET_KEY);
  });

  it('maps a 200 with is_success:false to an API error', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(failureEnvelope('duplicate reference')));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'POST', path: '/vi/pay/initiate' }));

    expect(error).toBeInstanceOf(MyImoPayApiError);
    expect(error.code).toBe('DUPLICATE_REFERENCE');
    expect((error as MyImoPayApiError).status).toBe(200);
  });

  it('maps an unclassified is_success:false response to PROVIDER_ERROR', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(failureEnvelope('something odd')));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'POST', path: '/vi/pay/initiate' }));

    expect(error.code).toBe('PROVIDER_ERROR');
  });
});

describe('HttpClient retries', () => {
  it('retries a 429 with retry-after and succeeds', async () => {
    const { fetch, calls } = recordingFetch((_call, index) =>
      index === 0
        ? jsonResponse(failureEnvelope('rate limited'), 429, { 'retry-after': '1' })
        : jsonResponse(successEnvelope({ ok: true })),
    );
    const client = new HttpClient(
      configWith({ fetch, retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 5 } }),
    );

    const result = await client.request({ method: 'GET', path: '/vi/pay/verify' });

    expect(result.data).toEqual({ ok: true });
    expect(calls.length).toBe(2);
  });

  it('retries a 500 and then succeeds', async () => {
    const { fetch, calls } = recordingFetch((_call, index) =>
      index === 0
        ? jsonResponse(failureEnvelope('boom'), 500)
        : jsonResponse(successEnvelope({ ok: true })),
    );
    const client = new HttpClient(
      configWith({ fetch, retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 } }),
    );

    const result = await client.request({ method: 'GET', path: '/vi/pay/verify' });

    expect(result.data).toEqual({ ok: true });
    expect(calls.length).toBe(2);
  });

  it('exhausts the attempt budget on a persistent 500', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(failureEnvelope('boom'), 500));
    const client = new HttpClient(
      configWith({ fetch, retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 } }),
    );

    const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

    expect(error.code).toBe('PROVIDER_ERROR');
    expect(calls.length).toBe(3);
  });

  it('never retries a 400', async () => {
    const { fetch, calls } = recordingFetch(() =>
      jsonResponse(failureEnvelope('invalid amount'), 400),
    );
    const client = new HttpClient(
      configWith({ fetch, retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 } }),
    );

    const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(calls.length).toBe(1);
  });

  it('does not retry a write unless it is marked retryable', async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(failureEnvelope('boom'), 500));
    const client = new HttpClient(
      configWith({ fetch, retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 } }),
    );

    await captureError(
      client.request({ method: 'POST', path: '/vi/pay/initiate', body: { reference: 'ref_1' } }),
    );

    expect(calls.length).toBe(1);
  });

  it('retries a write marked retryableWrite', async () => {
    const { fetch, calls } = recordingFetch((_call, index) =>
      index === 0
        ? jsonResponse(failureEnvelope('boom'), 500)
        : jsonResponse(successEnvelope({ ok: true })),
    );
    const client = new HttpClient(
      configWith({ fetch, retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 5 } }),
    );

    await client.request({
      method: 'POST',
      path: '/vi/pay/initiate',
      body: { reference: 'ref_1' },
      retryableWrite: true,
    });

    expect(calls.length).toBe(2);
  });
});

describe('HttpClient timeout and abort', () => {
  it('times out a hung fetch', async () => {
    const { fetch } = recordingFetch(() => new Promise<FetchResponseLike>(() => {}));
    const client = new HttpClient(configWith({ fetch, timeoutMs: 5 }));

    const error = await captureError(client.request({ method: 'GET', path: '/slow' }));

    expect(error).toBeInstanceOf(MyImoPayTimeoutError);
    expect(error.code).toBe('TIMEOUT_ERROR');
  });

  it('rejects a caller abort with ABORTED and does not retry', async () => {
    const controller = new AbortController();
    const { fetch, calls } = recordingFetch(() => new Promise<FetchResponseLike>(() => {}));
    const client = new HttpClient(
      configWith({ fetch, retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 } }),
    );

    const pending = client.request({ method: 'GET', path: '/slow', signal: controller.signal });
    controller.abort();

    const error = await captureError(pending);

    expect(error.code).toBe('ABORTED');
    expect(calls.length).toBe(1);
  });
});

describe('HttpClient malformed responses', () => {
  it('rejects a non-JSON body', async () => {
    const { fetch } = recordingFetch(() => responseOf('not json at all'));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

    expect(error.code).toBe('MALFORMED_RESPONSE');
  });

  it('rejects an empty body', async () => {
    const { fetch } = recordingFetch(() => responseOf('   '));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

    expect(error.code).toBe('MALFORMED_RESPONSE');
  });

  it('rejects a body above the 1 MiB cap', async () => {
    const oversized = 'x'.repeat(1024 * 1024 + 1);
    const { fetch } = recordingFetch(() => responseOf(oversized));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

    expect(error.code).toBe('MALFORMED_RESPONSE');
  });

  it('rejects a successful envelope whose data is null', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(successEnvelope(null)));
    const client = new HttpClient(configWith({ fetch }));

    const error = await captureError(client.request({ method: 'GET', path: '/vi/pay/verify' }));

    expect(error.code).toBe('MALFORMED_RESPONSE');
  });
});

describe('HttpClient debug events', () => {
  it('emits request/response/retry and never a key', async () => {
    const events: DebugEvent[] = [];
    const { fetch } = recordingFetch((_call, index) =>
      index === 0
        ? jsonResponse(failureEnvelope('boom'), 500)
        : jsonResponse(successEnvelope({ ok: true })),
    );
    const client = new HttpClient(
      configWith({
        fetch,
        retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 5 },
        onDebug: (event) => {
          events.push(event);
        },
      }),
    );

    await client.request({
      method: 'POST',
      path: '/vi/pay/initiate',
      body: { reference: 'ref_1' },
      auth: 'secret',
      retryableWrite: true,
    });

    const types = events.map((event) => event.type);
    expect(types).toContain('request');
    expect(types).toContain('response');
    expect(types).toContain('retry');

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(PUBLIC_KEY);
    expect(serialized).not.toContain(SECRET_KEY);
  });

  it('emits an error event when the provider rejects', async () => {
    const events: DebugEvent[] = [];
    const { fetch } = recordingFetch(() => jsonResponse(failureEnvelope('nope'), 400));
    const client = new HttpClient(
      configWith({
        fetch,
        onDebug: (event) => {
          events.push(event);
        },
      }),
    );

    await captureError(client.request({ method: 'POST', path: '/vi/pay/initiate' }));

    expect(events.map((event) => event.type)).toContain('error');
    expect(JSON.stringify(events)).not.toContain(PUBLIC_KEY);
  });

  it('does not let a throwing debug hook break the request', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(successEnvelope({ ok: true })));
    const client = new HttpClient(
      configWith({
        fetch,
        onDebug: () => {
          throw new Error('diagnostics blew up');
        },
      }),
    );

    const result = await client.request({ method: 'GET', path: '/vi/pay/verify' });

    expect(result.data).toEqual({ ok: true });
  });
});
