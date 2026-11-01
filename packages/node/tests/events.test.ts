// @sdk-owner: A12-events
// @sdk-phase: 3

import { describe, expect, it } from 'bun:test';
import { MyImoPayValidationError } from '@core/errors';
import { createPaymentEventBus, type PaymentEvent } from '@node/events';

function event(reference: string, status: PaymentEvent['status']): PaymentEvent {
  return { reference, providerReference: `prov-${reference}`, status, raw: null };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('createPaymentEventBus', () => {
  it('delivers a success once and then forgets the subscription', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('ref-1', {
      onSuccess: (payload) => {
        seen.push(`success:${payload.providerReference ?? 'none'}`);
      },
      onFailed: () => {
        seen.push('failed');
      },
      onClose: (outcome) => {
        seen.push(`close:${outcome}`);
      },
    });

    expect(await bus.emit(event('ref-1', 'succeeded'))).toBe(1);
    expect(seen).toEqual(['success:prov-ref-1', 'close:succeeded']);
    expect(bus.size).toBe(0);
  });

  it('routes failed and expired to their own handlers', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('a', {
      onFailed: () => {
        seen.push('failed:a');
      },
      onClose: (outcome) => {
        seen.push(`close:${outcome}`);
      },
    });
    bus.on('b', {
      onExpired: () => {
        seen.push('expired:b');
      },
      onClose: (outcome) => {
        seen.push(`close:${outcome}`);
      },
    });

    await bus.emit(event('a', 'failed'));
    await bus.emit(event('b', 'expired'));

    expect(seen).toEqual(['failed:a', 'close:failed', 'expired:b', 'close:expired']);
  });

  it('ignores non-terminal statuses without consuming the subscription', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('ref-1', {
      onSuccess: () => {
        seen.push('success');
      },
    });

    expect(await bus.emit(event('ref-1', 'pending'))).toBe(0);
    expect(await bus.emit(event('ref-1', 'initiated'))).toBe(0);
    expect(bus.size).toBe(1);
    expect(await bus.emit(event('ref-1', 'succeeded'))).toBe(1);
    expect(seen).toEqual(['success']);
  });

  it('never grants value twice for a re-delivered webhook', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('ref-1', {
      onSuccess: () => {
        seen.push('success');
      },
    });

    expect(await bus.emit(event('ref-1', 'succeeded'))).toBe(1);
    expect(await bus.emit(event('ref-1', 'succeeded'))).toBe(0);
    expect(seen).toEqual(['success']);
  });

  it('delivers to every subscriber of the same reference', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('ref-1', { onSuccess: () => void seen.push('first') });
    bus.on('ref-1', { onSuccess: () => void seen.push('second') });

    expect(await bus.emit(event('ref-1', 'succeeded'))).toBe(2);
    expect(seen.sort()).toEqual(['first', 'second']);
  });

  it('closes with cancelled on unsubscribe, exactly once and idempotently', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    const unsubscribe = bus.on('ref-1', {
      onClose: (outcome) => {
        seen.push(outcome);
      },
    });

    unsubscribe();
    unsubscribe();

    expect(seen).toEqual(['cancelled']);
    expect(bus.size).toBe(0);
    expect(await bus.emit(event('ref-1', 'succeeded'))).toBe(0);
  });

  it('expires a subscription after its TTL and closes it with timeout', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on(
      'ref-1',
      {
        onSuccess: () => {
          seen.push('success');
        },
        onClose: (outcome) => {
          seen.push(`close:${outcome}`);
        },
      },
      { ttlMs: 1 },
    );

    await sleep(10);

    expect(bus.size).toBe(0);
    expect(seen).toEqual(['close:timeout']);
    expect(await bus.emit(event('ref-1', 'succeeded'))).toBe(0);
  });

  it('evicts the oldest subscription when the cap is reached', async () => {
    const bus = createPaymentEventBus({ maxSubscriptions: 1 });
    const seen: string[] = [];

    bus.on('old', { onClose: (outcome) => void seen.push(`old:${outcome}`) });
    bus.on('new', { onClose: (outcome) => void seen.push(`new:${outcome}`) });

    expect(seen).toEqual(['old:timeout']);
    expect(bus.size).toBe(1);
    expect(await bus.emit(event('old', 'succeeded'))).toBe(0);
  });

  it('clear() closes everything with cancelled', () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('a', { onClose: (outcome) => void seen.push(`a:${outcome}`) });
    bus.on('b', { onClose: (outcome) => void seen.push(`b:${outcome}`) });
    bus.clear();

    expect(seen.sort()).toEqual(['a:cancelled', 'b:cancelled']);
    expect(bus.size).toBe(0);
  });

  it('swallows a throwing subscriber so a webhook handler never fails', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('ref-1', {
      onSuccess: () => {
        throw new Error('subscriber bug');
      },
      onClose: () => {
        seen.push('closed');
      },
    });

    expect(await bus.emit(event('ref-1', 'succeeded'))).toBe(1);
    expect(seen).toEqual(['closed']);
  });

  it('refuses an unverified event so a forged webhook cannot grant value', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('ref-1', { onSuccess: () => void seen.push('paid') });

    await expect(bus.emit({ ...event('ref-1', 'succeeded'), verified: false })).rejects.toThrow(
      MyImoPayValidationError,
    );
    expect(seen).toEqual([]);
    expect(bus.size).toBe(1);
  });

  it('delivers an unverified event only after the caller confirms verification', async () => {
    const bus = createPaymentEventBus();
    const seen: string[] = [];

    bus.on('ref-1', { onSuccess: () => void seen.push('paid') });

    const delivered = await bus.emit(
      { ...event('ref-1', 'succeeded'), verified: false },
      {
        allowUnverified: true,
      },
    );

    expect(delivered).toBe(1);
    expect(seen).toEqual(['paid']);
  });

  it('rejects a subscription without a reference or handlers', () => {
    const bus = createPaymentEventBus();

    expect(() => bus.on('', { onSuccess: () => undefined })).toThrow(MyImoPayValidationError);
    expect(() => bus.on('ref', {})).toThrow(MyImoPayValidationError);
    expect(() => bus.on('ref', { onSuccess: () => undefined }, { ttlMs: 0 })).toThrow(
      MyImoPayValidationError,
    );
  });
});
