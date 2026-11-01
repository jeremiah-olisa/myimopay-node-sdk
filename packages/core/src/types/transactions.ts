import type { Amount, ChargeBearer, Currency, PaymentStatus } from './common';

/** A transaction as returned by the merchant read endpoints. */
export interface Transaction {
  id: string | null;
  reference: string | null;
  providerReference: string | null;
  payReference: string | null;
  status: PaymentStatus;
  rawStatus: number | null;
  isSettled: boolean;
  isSplit: boolean;
  currency: Currency;
  amountInitial: Amount;
  amountCharged: Amount;
  amountPaid: Amount;
  amountPayout: Amount;
  feeAmount: Amount;
  taxAmount: Amount;
  adminFeeAmount: Amount;
  chargeBearer: ChargeBearer | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  settlementOrderId: string | null;
  callbackUrl: string | null;
  paymentLink: string | null;
  expiresAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  raw: unknown;
}

/** Filters accepted by `GET /vi/transactions/filter`. */
export interface TransactionQuery {
  page?: number;
  pageSize?: number;
  status?: PaymentStatus | number;
  fromDate?: string | Date;
  toDate?: string | Date;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** A page of transactions. The provider's paging envelope is not in its schema. */
export interface TransactionPage {
  items: Transaction[];
  total: number | null;
  page: number | null;
  pageSize: number | null;
  raw: unknown;
}

/** Date window accepted by the summary/analytics endpoints. */
export interface DateRangeQuery {
  fromDate?: string | Date;
  toDate?: string | Date;
}

/** `status-counts` and `summary` return provider-shaped objects. */
export type ProviderRecord = Record<string, unknown>;
