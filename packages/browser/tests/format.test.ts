// @sdk-owner: A8-browser
// @sdk-phase: 1
// @sdk-implemented-by: A8-browser

import { describe, expect, it } from 'bun:test';
import { describePaymentStatus, formatAmount } from '@browser/format';
import type { PaymentStatus } from '@core/types/common';
import { formatMoney } from '@core/utils/amount';

describe('formatAmount', () => {
  it('delegates to core formatMoney with the same defaults', () => {
    expect(formatAmount(1500.1)).toBe(formatMoney(1500.1));
    expect(formatAmount(300)).toBe(formatMoney(300));
  });

  it('honours an explicit currency and locale', () => {
    const formatted = formatAmount(1500.1, 'USD', 'en-US');

    expect(formatted).toBe(formatMoney(1500.1, 'USD', 'en-US'));
    expect(formatted).toContain('1,500.10');
  });

  it('falls back to the currency code for an unknown one', () => {
    expect(formatAmount(10, 'NOTACURRENCY')).toBe('NOTACURRENCY 10.00');
  });

  it('keeps two decimals on a whole amount', () => {
    expect(formatAmount(2500, 'NGN', 'en-NG')).toContain('2,500.00');
  });
});

describe('describePaymentStatus', () => {
  const labels: ReadonlyArray<readonly [PaymentStatus, string]> = [
    ['succeeded', 'Paid'],
    ['pending', 'Pending'],
    ['initiated', 'Awaiting payment'],
    ['failed', 'Failed'],
    ['expired', 'Expired'],
    ['unknown', 'Unknown'],
  ];

  it('maps every status to payer-facing wording', () => {
    for (const [status, label] of labels) {
      expect(describePaymentStatus(status)).toBe(label);
    }
  });

  it('never calls a non-successful status paid', () => {
    for (const [status, label] of labels) {
      if (status !== 'succeeded') expect(label).not.toBe('Paid');
    }
  });
});
