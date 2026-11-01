// @sdk-owner: A14-dx
// @sdk-phase: 4

import { describe, expect, it } from 'bun:test';
import { createCheckout, type VerifyCheckout } from '@browser/checkout';

const verify: VerifyCheckout = async () => {
  throw new Error('not called in this test');
};

/**
 * Type-level guarantees. `@ts-expect-error` is enforced by `tsc --noEmit`, so
 * these fail the build if the union ever loosens.
 */
describe('checkout option typings', () => {
  it('accepts status callbacks only together with verify', () => {
    const checkout = createCheckout({
      verify,
      onSuccess: () => undefined,
      onFailed: () => undefined,
      onExpired: () => undefined,
    });

    expect(typeof checkout.open).toBe('function');
  });

  it('rejects status callbacks without verify', () => {
    // @ts-expect-error onSuccess is meaningless without a verify function.
    createCheckout({ onSuccess: () => undefined });

    // @ts-expect-error onFailed is meaningless without a verify function.
    createCheckout({ onFailed: () => undefined });

    // @ts-expect-error onExpired is meaningless without a verify function.
    createCheckout({ onExpired: () => undefined });
  });

  it('allows the keyless lifecycle without verify', () => {
    const checkout = createCheckout({
      mode: 'redirect',
      onOpen: () => undefined,
      onClose: () => undefined,
    });

    expect(typeof checkout.resume).toBe('function');
  });
});
