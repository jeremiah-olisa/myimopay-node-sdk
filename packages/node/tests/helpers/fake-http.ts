// @sdk-owner: A0-contracts
// @sdk-phase: 1

import type { ApiResult, HttpConfig, HttpRequestOptions, ResponseHeader } from '@myimopay/core';
import { HttpClient } from '@myimopay/core';

/** A transport config that is already valid, for tests that do not care about config. */
export function testHttpConfig(overrides: Partial<HttpConfig> = {}): HttpConfig {
  return {
    baseUrl: 'https://mock.myimopay.test',
    publicKey: 'pk_test_public_key_value',
    publicKeyHeader: 'xp-key',
    secretKeyHeader: 'sp-key',
    timeoutMs: 1000,
    retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 2 },
    headers: {},
    fetch: async () => {
      throw new Error('test fetch must not be called');
    },
    userAgent: 'myimopay-test',
    ...overrides,
  };
}

/** Builds the response header the SDK normalises from the wire. */
function testHeader(overrides: Partial<ResponseHeader> = {}): ResponseHeader {
  return {
    isSuccess: true,
    status: 'success',
    remark: null,
    timeStamp: 1_700_000_000,
    ...overrides,
  };
}

/** Builds a successful `ApiResult` around any data. */
export function ok<T>(data: T, header: Partial<ResponseHeader> = {}): ApiResult<T> {
  return {
    data,
    header: testHeader(header),
    status: 200,
    raw: { header: { ['is_success']: true }, data },
  };
}

export type Responder = (
  options: HttpRequestOptions,
) => ApiResult<unknown> | Promise<ApiResult<unknown>>;

/**
 * An `HttpClient` that records calls and answers from a handler.
 *
 * Resources are tested against this, so no test ever touches the network and
 * the transport can be developed independently.
 */
export class FakeHttpClient extends HttpClient {
  readonly calls: HttpRequestOptions[] = [];
  readonly #responder: Responder;

  constructor(responder: Responder) {
    super(testHttpConfig());
    this.#responder = responder;
  }

  override async request<T>(options: HttpRequestOptions): Promise<ApiResult<T>> {
    this.calls.push(options);
    return (await this.#responder(options)) as ApiResult<T>;
  }

  /** The last path this client was asked for. */
  get lastPath(): string | undefined {
    return this.calls.at(-1)?.path;
  }

  /** The last query object this client was asked for. */
  get lastQuery(): HttpRequestOptions['query'] {
    return this.calls.at(-1)?.query;
  }

  /** The last request body this client was asked for. */
  get lastBody(): unknown {
    return this.calls.at(-1)?.body;
  }
}
