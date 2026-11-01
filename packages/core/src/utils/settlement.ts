// @sdk-implemented-by: F2-primitives
import { MyImoPayValidationError } from '../errors';
import type { SettlementOrderItemInput } from '../types/entities';

/** 100% is the merchant's own share, so subaccount legs must stay below it. */
const FULL_PERCENTAGE = 100;

/** Two decimals is all a percentage needs; this only tidies the error message. */
function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Provider rule: the subaccount percentages on a split order must total
 * strictly less than 100%, because the merchant keeps the remainder.
 *
 * Checking locally turns a funded-but-rejected payment into an immediate,
 * actionable error. `send-merchant-remainder` is the documented fix.
 */
export function assertSettlementPercentages(items: SettlementOrderItemInput[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new MyImoPayValidationError(
      'items must contain at least one settlement item; received an empty list.',
      'items',
    );
  }

  let total = 0;
  for (const [index, item] of items.entries()) {
    const percentage = item.percentage;
    // A fixed-amount leg contributes no percentage to the split.
    if (percentage === undefined) continue;

    if (typeof percentage !== 'number' || !Number.isFinite(percentage)) {
      throw new MyImoPayValidationError(
        `items[${index}].percentage must be a finite number; received ${String(percentage)}.`,
        'items',
      );
    }
    if (percentage <= 0 || percentage >= FULL_PERCENTAGE) {
      throw new MyImoPayValidationError(
        `items[${index}].percentage must be greater than 0 and less than ${FULL_PERCENTAGE}; received ${percentage}.`,
        'items',
      );
    }
    total += percentage;
  }

  if (total >= FULL_PERCENTAGE) {
    throw new MyImoPayValidationError(
      `settlement percentages total ${roundPercent(total)}%; they must total strictly less than ` +
        `${FULL_PERCENTAGE}% because the merchant keeps the remainder. ` +
        `Reduce the split by at least ${roundPercent(total - FULL_PERCENTAGE + 0.01)}%.`,
      'items',
    );
  }
}

/** True when every item is a percentage leg (no fixed-amount legs). */
export function isPercentageOnly(items: SettlementOrderItemInput[]): boolean {
  return items.every((item) => item.isFixed !== true);
}
