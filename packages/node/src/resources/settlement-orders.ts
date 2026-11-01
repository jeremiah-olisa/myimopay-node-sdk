import type { CreateSettlementOrderInput, RequestOptions, SettlementOrder } from '@myimopay/core';
import type { ResourceContext } from '../context';

/** Split instructions (`/vi/entities/merchant/settlements/orders*`). Requires the secret key. */
export class SettlementOrdersResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  async list(options?: RequestOptions): Promise<SettlementOrder[]> {
    void options;
    void this.#context;
    throw new Error('not implemented: SettlementOrdersResource.list');
  }

  async get(id: string, options?: RequestOptions): Promise<SettlementOrder> {
    void id;
    void options;
    throw new Error('not implemented: SettlementOrdersResource.get');
  }

  async create(
    input: CreateSettlementOrderInput,
    options?: RequestOptions,
  ): Promise<SettlementOrder> {
    void input;
    void options;
    throw new Error('not implemented: SettlementOrdersResource.create');
  }

  async update(
    id: string,
    input: CreateSettlementOrderInput,
    options?: RequestOptions,
  ): Promise<SettlementOrder> {
    void id;
    void input;
    void options;
    throw new Error('not implemented: SettlementOrdersResource.update');
  }
}
