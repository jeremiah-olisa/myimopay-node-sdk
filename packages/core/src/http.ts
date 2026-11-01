import type { ApiResult } from './types/common';
import type { HttpConfig, HttpRequestOptions } from './types/config';

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
    void options;
    throw new Error('not implemented: HttpClient.request');
  }
}
