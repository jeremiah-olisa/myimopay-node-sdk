import type { HttpClient } from '@myimopay/core';
import type { ResolvedCustomerPolicy } from './config';

/**
 * Everything a resource is allowed to depend on. Resources never see the
 * client's full configuration, which keeps them trivially testable and stops
 * credentials from spreading through the codebase.
 */
export interface ResourceContext {
  readonly http: HttpClient;
  /** Optional per-transaction ceiling enforced before initiation. */
  readonly maxAmount: number | undefined;
  /** Customer-field policy; absent means "apply the documented defaults". */
  readonly customer: ResolvedCustomerPolicy | undefined;
}
