import type { Amount, ChargeBearer, Currency } from './common';

export interface Bank {
  /** Bank code used by `banks.resolve`. */
  code: string | null;
  name: string | null;
  countryCode: string | null;
  swiftCode: string | null;
  bankType: string | null;
  routingNumber: string | null;
  raw: unknown;
}

export interface BankAccount {
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  branchCode: string | null;
  raw: unknown;
}

export interface Subaccount {
  id: string | null;
  code: string | null;
  name: string | null;
  bankCode: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  currency: Currency | null;
  email: string | null;
  phone: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  raw: unknown;
}

export interface CreateSubaccountInput {
  /** Display name. Defaults to the account name on the provider side. */
  name: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** Defaults to `NGN`. */
  currency?: Currency;
  email?: string;
  phone?: string;
  /** Stable caller-side identifier; makes creation idempotent. */
  identifier?: string;
}

/** One allocation inside a settlement order. */
export interface SettlementOrderItemInput {
  subaccountId: string;
  /** Percentage of each transaction, 0 < percentage < 100. */
  percentage?: number;
  fixedAmount?: Amount;
  isFixed?: boolean;
}

export interface CreateSettlementOrderInput {
  name: string;
  items: SettlementOrderItemInput[];
  /** Defaults to `customer` (the payer bears the charge). */
  chargeBearer?: ChargeBearer;
  overrideChargeBearer?: boolean;
  identifier?: string;
}

export interface SettlementOrderItem {
  subaccountId: string | null;
  percentage: number;
  fixedAmount: Amount;
  isFixed: boolean;
  raw: unknown;
}

export interface SettlementOrder {
  id: string | null;
  name: string | null;
  chargeBearer: ChargeBearer | null;
  overrideChargeBearer: boolean;
  isMixed: boolean;
  items: SettlementOrderItem[];
  createdAt: Date | null;
  updatedAt: Date | null;
  raw: unknown;
}
