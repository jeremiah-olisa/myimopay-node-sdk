// @sdk-owner: A8-browser
// @sdk-phase: 1
// @sdk-implemented-by: A8-browser

import { describe, expect, it } from 'bun:test';
import type { CheckoutHint } from '@browser/parse';
import { parseCheckoutResult } from '@browser/parse';

const EMPTY: CheckoutHint = {
  reference: null,
  statusHint: null,
  referenceMatches: false,
  rawQuery: {},
  verified: false,
};

describe('parseCheckoutResult', () => {
  it('returns empty hints for empty input', () => {
    expect(parseCheckoutResult('')).toEqual(EMPTY);
    expect(parseCheckoutResult('   ')).toEqual(EMPTY);
  });

  it('reads a leading question-mark query', () => {
    const hint = parseCheckoutResult('?tx_ref=ref-1&status=success');

    expect(hint.reference).toBe('ref-1');
    expect(hint.statusHint).toBe('success');
    expect(hint.rawQuery).toEqual({ tx_ref: 'ref-1', status: 'success' });
    expect(hint.verified).toBe(false);
  });

  it('reads a bare query string', () => {
    expect(parseCheckoutResult('tx_ref=ref-2').reference).toBe('ref-2');
  });

  it('reads a full return URL', () => {
    const hint = parseCheckoutResult(
      'https://app.example/thank-you?reference=ref-3&payment_status=paid#receipt',
    );

    expect(hint.reference).toBe('ref-3');
    expect(hint.statusHint).toBe('paid');
    expect(hint.rawQuery).toEqual({ reference: 'ref-3', payment_status: 'paid' });
  });

  it('treats a URL or path without a query as empty', () => {
    expect(parseCheckoutResult('https://app.example/thank-you')).toEqual(EMPTY);
    expect(parseCheckoutResult('/thank-you')).toEqual(EMPTY);
    expect(parseCheckoutResult('#receipt')).toEqual(EMPTY);
  });

  it('keeps the first value of a repeated key', () => {
    const hint = parseCheckoutResult('tx_ref=first&tx_ref=second&status=a&status=b');

    expect(hint.reference).toBe('first');
    expect(hint.statusHint).toBe('a');
    expect(hint.rawQuery).toEqual({ tx_ref: 'first', status: 'a' });
  });

  it('prefers tx_ref over every other reference key', () => {
    expect(parseCheckoutResult('?reference=fallback&tx_ref=primary&ref=third').reference).toBe(
      'primary',
    );
    expect(parseCheckoutResult('?tx_reference=second&ref=third').reference).toBe('second');
  });

  it('skips a blank reference and falls through to the next key', () => {
    expect(parseCheckoutResult('?tx_ref=&reference=actual').reference).toBe('actual');
    expect(parseCheckoutResult('?tx_ref=%20%20').reference).toBeNull();
  });

  it('reads the status hint from each alias', () => {
    expect(parseCheckoutResult('?status=success').statusHint).toBe('success');
    expect(parseCheckoutResult('?payment_status=pending').statusHint).toBe('pending');
    expect(parseCheckoutResult('?transaction_status=expired').statusHint).toBe('expired');
    expect(parseCheckoutResult('?tx_ref=ref-1').statusHint).toBeNull();
  });

  it('matches only a supplied, equal expected reference', () => {
    expect(parseCheckoutResult('?tx_ref=abc', { expectedReference: 'abc' }).referenceMatches).toBe(
      true,
    );
    expect(parseCheckoutResult('?tx_ref=abc', { expectedReference: 'def' }).referenceMatches).toBe(
      false,
    );
    expect(parseCheckoutResult('?tx_ref=abc').referenceMatches).toBe(false);
    expect(
      parseCheckoutResult('?status=success', { expectedReference: 'abc' }).referenceMatches,
    ).toBe(false);
  });

  it('never throws on junk encoding', () => {
    const hint = parseCheckoutResult('?tx_ref=%E0%A4%A&status=%zz&empty=&bare');

    // Malformed escapes decode however `URLSearchParams` sees fit; the point is
    // that nothing throws and every key survives.
    expect(hint.reference).not.toBeNull();
    expect(hint.rawQuery['status']).toBe('%zz');
    expect(hint.rawQuery['empty']).toBe('');
    expect(hint.rawQuery['bare']).toBe('');
  });

  it('keeps a __proto__ key as data, not as a prototype', () => {
    const protoKey = '__proto__';
    const hint = parseCheckoutResult(`?${protoKey}=polluted&tx_ref=ref-4`);

    expect(hint.rawQuery[protoKey]).toBe('polluted');
    expect(Object.getPrototypeOf(hint.rawQuery)).toBe(Object.prototype);
  });
});
