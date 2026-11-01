import type {
  DateRangeQuery,
  ProviderRecord,
  RequestOptions,
  Transaction,
  TransactionPage,
  TransactionQuery,
} from '@myimopay/core';
import type { ResourceContext } from '../context';

/** Read-only transaction history (`/vi/transactions*`). */
export class TransactionsResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  /** Full unpaginated list. Prefer `filter()` for anything user-facing. */
  async list(options?: RequestOptions): Promise<Transaction[]> {
    void options;
    void this.#context;
    throw new Error('not implemented: TransactionsResource.list');
  }

  /** Paginated, filtered list. */
  async filter(query?: TransactionQuery, options?: RequestOptions): Promise<TransactionPage> {
    void query;
    void options;
    throw new Error('not implemented: TransactionsResource.filter');
  }

  async findByReference(reference: string, options?: RequestOptions): Promise<Transaction | null> {
    void reference;
    void options;
    throw new Error('not implemented: TransactionsResource.findByReference');
  }

  async findById(identifier: string, options?: RequestOptions): Promise<Transaction | null> {
    void identifier;
    void options;
    throw new Error('not implemented: TransactionsResource.findById');
  }

  async summary(range?: DateRangeQuery, options?: RequestOptions): Promise<ProviderRecord> {
    void range;
    void options;
    throw new Error('not implemented: TransactionsResource.summary');
  }

  async statusCounts(options?: RequestOptions): Promise<ProviderRecord> {
    void options;
    throw new Error('not implemented: TransactionsResource.statusCounts');
  }

  async analytics(days?: number, options?: RequestOptions): Promise<ProviderRecord> {
    void days;
    void options;
    throw new Error('not implemented: TransactionsResource.analytics');
  }
}
