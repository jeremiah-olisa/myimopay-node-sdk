import { MyImoPayValidationError } from '../errors';
import type { SettlementOrderItemInput } from '../types/entities';

/**
 * Provider rule: the subaccount percentages on a split order must total
 * strictly less than 100%, because the merchant keeps the remainder.
 *
 * Checking locally turns a funded-but-rejected payment into an immediate,
 * actionable error. `send-merchant-remainder` is the documented fix.
 */
export function assertSettlementPercentages(items: SettlementOrderItemInput[]): void {
  void items;
  throw new MyImoPayValidationError('not implemented: assertSettlementPercentages', 'items');
}

/** True when every item is a percentage leg (no fixed-amount legs). */
export function isPercentageOnly(items: SettlementOrderItemInput[]): boolean {
  void items;
  throw new Error('not implemented: isPercentageOnly');
}
