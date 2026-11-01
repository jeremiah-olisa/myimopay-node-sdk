import type {
  DirectSettlement,
  RequestOptions,
  SettlementQuery,
  SplitSettlement,
} from '@myimopay/core';
import type { ResourceContext } from '../context';

/**
 * Settlement reports (`/vi/settlements/*`).
 *
 * These endpoints signal "nothing matched" with a 404 envelope or `data: null`.
 * Both mean an empty list, never an error.
 */
export class SettlementsResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  async directs(query?: SettlementQuery, options?: RequestOptions): Promise<DirectSettlement[]> {
    void query;
    void options;
    void this.#context;
    throw new Error('not implemented: SettlementsResource.directs');
  }

  async splits(query?: SettlementQuery, options?: RequestOptions): Promise<SplitSettlement[]> {
    void query;
    void options;
    throw new Error('not implemented: SettlementsResource.splits');
  }

  /** A missing reference is a legitimate `null`, not an error. */
  async directByReference(
    reference: string,
    options?: RequestOptions,
  ): Promise<DirectSettlement | null> {
    void reference;
    void options;
    throw new Error('not implemented: SettlementsResource.directByReference');
  }

  async splitByReference(
    reference: string,
    options?: RequestOptions,
  ): Promise<SplitSettlement | null> {
    void reference;
    void options;
    throw new Error('not implemented: SettlementsResource.splitByReference');
  }

  async splitByOrder(
    settlementOrderId: string,
    options?: RequestOptions,
  ): Promise<SplitSettlement[]> {
    void settlementOrderId;
    void options;
    throw new Error('not implemented: SettlementsResource.splitByOrder');
  }
}
