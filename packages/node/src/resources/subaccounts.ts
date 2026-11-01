import type { CreateSubaccountInput, RequestOptions, Subaccount } from '@myimopay/core';
import type { ResourceContext } from '../context';

/** Merchant subaccounts (`/vi/entities/merchant/subaccounts/*`). Requires the secret key. */
export class SubaccountsResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  async list(options?: RequestOptions): Promise<Subaccount[]> {
    void options;
    void this.#context;
    throw new Error('not implemented: SubaccountsResource.list');
  }

  async get(id: string, options?: RequestOptions): Promise<Subaccount> {
    void id;
    void options;
    throw new Error('not implemented: SubaccountsResource.get');
  }

  async create(input: CreateSubaccountInput, options?: RequestOptions): Promise<Subaccount> {
    void input;
    void options;
    throw new Error('not implemented: SubaccountsResource.create');
  }
}
