import type { Amount, ChargeBearer, Currency, PaymentStatus } from './common';

/** One leg of a split settlement. */
export interface SplitAllocation {
  subaccountId: string | null;
  /** Percentage of the transaction allocated to this leg. */
  percentAmount: Amount;
  fixedAmount: Amount;
  isFixed: boolean;
  raw: unknown;
}

/** A direct (non-split) settlement report row. */
export interface DirectSettlement {
  reference: string | null;
  providerReference: string | null;
  status: PaymentStatus;
  rawStatus: number | null;
  currency: Currency;
  amount: Amount;
  settledAmount: Amount;
  feeAmount: Amount;
  taxAmount: Amount;
  adminFeeAmount: Amount;
  chargeBearer: ChargeBearer | null;
  settlementOrderId: string | null;
  settledAt: Date | null;
  raw: unknown;
}

/** A split settlement report row. */
export interface SplitSettlement {
  reference: string | null;
  providerReference: string | null;
  settlementOrderId: string | null;
  status: PaymentStatus;
  rawStatus: number | null;
  currency: Currency;
  amount: Amount;
  settledAmount: Amount;
  feeAmount: Amount;
  taxAmount: Amount;
  adminFeeAmount: Amount;
  allocations: SplitAllocation[];
  settledAt: Date | null;
  raw: unknown;
}

/** Date window for the settlement report filters. Both bounds or neither. */
export interface SettlementQuery {
  fromDate?: string | Date;
  toDate?: string | Date;
}
