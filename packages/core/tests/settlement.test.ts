// @sdk-implemented-by: F2-primitives
import { describe, expect, test } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import type { SettlementOrderItemInput } from '@core/types/entities';
import { assertSettlementPercentages, isPercentageOnly } from '@core/utils/settlement';

/** Runs `fn` and returns the validation error it must throw. */
function caught(fn: () => void): MyImoPayValidationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof MyImoPayValidationError) return error;
    throw error;
  }
  throw new Error('expected fn to throw MyImoPayValidationError');
}

function percent(value: number, subaccountId = 'sub_1'): SettlementOrderItemInput {
  return { subaccountId, percentage: value };
}

describe('assertSettlementPercentages', () => {
  test('accepts a single percentage leg', () => {
    expect(() => assertSettlementPercentages([percent(50)])).not.toThrow();
    expect(() => assertSettlementPercentages([percent(0.5)])).not.toThrow();
    expect(() => assertSettlementPercentages([percent(99.99)])).not.toThrow();
  });

  test('accepts percentages that sum to just under 100', () => {
    expect(() => assertSettlementPercentages([percent(49.99), percent(50, 'sub_2')])).not.toThrow();
    expect(() =>
      assertSettlementPercentages([
        percent(33.33),
        percent(33.33, 'sub_2'),
        percent(33.33, 'sub_3'),
      ]),
    ).not.toThrow();
  });

  test('rejects an empty item list', () => {
    const error = caught(() => assertSettlementPercentages([]));
    expect(error.field).toBe('items');
    expect(error.message).toContain('at least one');
  });

  test('rejects a sum of exactly 100, naming the total and the merchant remainder', () => {
    const error = caught(() => assertSettlementPercentages([percent(50), percent(50, 'sub_2')]));
    expect(error.field).toBe('items');
    expect(error.message).toContain('100%');
    expect(error.message).toContain('merchant keeps the remainder');
  });

  test('rejects a sum just above 100 and names the computed total', () => {
    const error = caught(() => assertSettlementPercentages([percent(50.01), percent(50, 'sub_2')]));
    expect(error.message).toContain('100.01%');
    expect(error.message).toContain('merchant keeps the remainder');
  });

  test('rejects a total of 99.99 + 0.01', () => {
    expect(() => assertSettlementPercentages([percent(99.99), percent(0.01, 'sub_2')])).toThrow(
      MyImoPayValidationError,
    );
  });

  test('rejects a leg at or beyond the boundaries', () => {
    for (const value of [0, 100, -5, 150]) {
      const error = caught(() => assertSettlementPercentages([percent(value)]));
      expect(error.message).toContain('items[0].percentage');
      expect(error.message).toContain('greater than 0 and less than 100');
    }
  });

  test('rejects a percentage that is not a finite number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '50']) {
      const item = { subaccountId: 'sub_1', percentage: value as unknown as number };
      expect(() => assertSettlementPercentages([item])).toThrow(MyImoPayValidationError);
    }
  });

  test('allows fixed-amount-only items, which contribute nothing to the sum', () => {
    expect(() =>
      assertSettlementPercentages([
        { subaccountId: 'sub_1', fixedAmount: 100, isFixed: true },
        { subaccountId: 'sub_2', fixedAmount: 250.5, isFixed: true },
      ]),
    ).not.toThrow();
  });

  test('allows a mixed order whose percentage legs stay under 100', () => {
    expect(() =>
      assertSettlementPercentages([
        { subaccountId: 'sub_1', fixedAmount: 100, isFixed: true },
        percent(40, 'sub_2'),
      ]),
    ).not.toThrow();
  });

  test('does not count a fixed leg towards the percentage total', () => {
    expect(() =>
      assertSettlementPercentages([
        percent(60),
        { subaccountId: 'sub_2', fixedAmount: 100, isFixed: true },
      ]),
    ).not.toThrow();
  });
});

describe('isPercentageOnly', () => {
  test('is true when every item is a percentage leg', () => {
    expect(isPercentageOnly([percent(10), { subaccountId: 'sub_2', percentage: 20 }])).toBe(true);
    expect(isPercentageOnly([{ subaccountId: 'sub_1', isFixed: false }])).toBe(true);
    expect(isPercentageOnly([{ subaccountId: 'sub_1' }])).toBe(true);
  });

  test('is false when any item is fixed', () => {
    expect(isPercentageOnly([percent(10), { subaccountId: 'sub_2', isFixed: true }])).toBe(false);
    expect(isPercentageOnly([{ subaccountId: 'sub_1', fixedAmount: 10, isFixed: true }])).toBe(
      false,
    );
  });

  test('is vacuously true for an empty list', () => {
    expect(isPercentageOnly([])).toBe(true);
  });
});
