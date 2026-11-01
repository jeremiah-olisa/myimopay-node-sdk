// @sdk-implemented-by: F2-primitives
import { describe, expect, test } from 'bun:test';
import type { PaymentStatus } from '@core/types/common';
import { isTerminalStatus, mapChargeBearer, mapPaymentStatus } from '@core/utils/status';

describe('mapPaymentStatus', () => {
  test('maps the documented integers', () => {
    expect(mapPaymentStatus(0)).toBe('initiated');
    expect(mapPaymentStatus(1)).toBe('pending');
    expect(mapPaymentStatus(2)).toBe('succeeded');
    expect(mapPaymentStatus(3)).toBe('failed');
    expect(mapPaymentStatus(4)).toBe('expired');
  });

  test('accepts numeric strings from the wire', () => {
    expect(mapPaymentStatus('0')).toBe('initiated');
    expect(mapPaymentStatus('1')).toBe('pending');
    expect(mapPaymentStatus('2')).toBe('succeeded');
    expect(mapPaymentStatus('3')).toBe('failed');
    expect(mapPaymentStatus('4')).toBe('expired');
    expect(mapPaymentStatus(' 2 ')).toBe('succeeded');
    expect(mapPaymentStatus('2.0')).toBe('succeeded');
  });

  test('maps everything else to unknown', () => {
    for (const value of [5, -1, 99, 1.5, null, undefined, Number.NaN, '', '  ', 'abc', 'NaN']) {
      expect(mapPaymentStatus(value)).toBe('unknown');
    }
  });

  test('lets is_settled beat a contradictory integer', () => {
    expect(mapPaymentStatus(3, true)).toBe('succeeded');
    expect(mapPaymentStatus(4, true)).toBe('succeeded');
    expect(mapPaymentStatus(0, true)).toBe('succeeded');
    expect(mapPaymentStatus(Number.NaN, true)).toBe('succeeded');
    expect(mapPaymentStatus(null, true)).toBe('succeeded');
    expect(mapPaymentStatus('3', true)).toBe('succeeded');
  });

  test('falls back to the integer when is_settled is false or absent', () => {
    expect(mapPaymentStatus(2, false)).toBe('succeeded');
    expect(mapPaymentStatus(3, false)).toBe('failed');
    expect(mapPaymentStatus(1, false)).toBe('pending');
    expect(mapPaymentStatus(3, null)).toBe('failed');
    expect(mapPaymentStatus(3, undefined)).toBe('failed');
    expect(mapPaymentStatus(1, null)).toBe('pending');
  });
});

describe('mapChargeBearer', () => {
  test('maps the documented integers', () => {
    expect(mapChargeBearer(1)).toBe('merchant');
    expect(mapChargeBearer(2)).toBe('customer');
    expect(mapChargeBearer(3)).toBe('split');
  });

  test('accepts numeric strings', () => {
    expect(mapChargeBearer('1')).toBe('merchant');
    expect(mapChargeBearer(' 2 ')).toBe('customer');
    expect(mapChargeBearer('3.0')).toBe('split');
  });

  test('returns null for anything else', () => {
    for (const value of [0, 4, -1, null, undefined, Number.NaN, '', 'abc']) {
      expect(mapChargeBearer(value)).toBeNull();
    }
  });
});

describe('isTerminalStatus', () => {
  test('is true only for the three terminal statuses', () => {
    const terminal: PaymentStatus[] = ['succeeded', 'failed', 'expired'];
    for (const status of terminal) {
      expect(isTerminalStatus(status)).toBe(true);
    }
  });

  test('is false for statuses that still need reconciling', () => {
    const open: PaymentStatus[] = ['initiated', 'pending', 'unknown'];
    for (const status of open) {
      expect(isTerminalStatus(status)).toBe(false);
    }
  });
});
