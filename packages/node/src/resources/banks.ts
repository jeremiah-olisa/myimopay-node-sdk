import type { Bank, BankAccount, RequestOptions } from '@myimopay/core';
import type { ResourceContext } from '../context';

/** Bank directory and account-name resolution. */
export class BanksResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  /** Banks for an ISO-3166 alpha-2 country (`NG`). */
  async list(countryCode: string, options?: RequestOptions): Promise<Bank[]> {
    void countryCode;
    void options;
    void this.#context;
    throw new Error('not implemented: BanksResource.list');
  }

  /** Resolves an account name before creating a subaccount. */
  async resolve(
    input: { bankCode: string; accountNumber: string },
    options?: RequestOptions,
  ): Promise<BankAccount> {
    void input;
    void options;
    throw new Error('not implemented: BanksResource.resolve');
  }
}
