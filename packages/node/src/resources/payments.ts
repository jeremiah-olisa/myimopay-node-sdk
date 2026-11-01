import type {
  InitiatePaymentInput,
  InitiateSplitPaymentInput,
  PaymentInitiation,
  RequestOptions,
  VerifiedPayment,
} from '@myimopay/core';
import type { ResourceContext } from '../context';
import type { PaymentWatcher, PaymentWatchHandlers, PaymentWatchOptions } from '../watch';
import { watchPayment } from '../watch';

/** Initiation and verification. The only two things a checkout needs. */
export class PaymentsResource {
  readonly #context: ResourceContext;

  constructor(context: ResourceContext) {
    this.#context = context;
  }

  /** Creates a hosted-checkout payment. `reference` is the idempotency key. */
  async initiate(
    input: InitiatePaymentInput,
    options?: RequestOptions,
  ): Promise<PaymentInitiation> {
    void input;
    void options;
    void this.#context;
    throw new Error('not implemented: PaymentsResource.initiate');
  }

  /** Creates a split payment against a settlement order. Requires the secret key. */
  async initiateSplit(
    input: InitiateSplitPaymentInput,
    options?: RequestOptions,
  ): Promise<PaymentInitiation> {
    void input;
    void options;
    throw new Error('not implemented: PaymentsResource.initiateSplit');
  }

  /** Verifies by `tx_ref`. This is the only proof of payment the SDK accepts. */
  async verify(reference: string, options?: RequestOptions): Promise<VerifiedPayment> {
    void reference;
    void options;
    throw new Error('not implemented: PaymentsResource.verify');
  }

  /** Verifies by the provider's internal identifier. */
  async verifyById(id: string, options?: RequestOptions): Promise<VerifiedPayment> {
    void id;
    void options;
    throw new Error('not implemented: PaymentsResource.verifyById');
  }

  /**
   * Polls `verify` until the payment is terminal, then fires exactly one
   * terminal callback and `onClose`. Returns immediately with a stop handle.
   */
  watch(
    reference: string,
    handlers?: PaymentWatchHandlers,
    options?: PaymentWatchOptions,
  ): PaymentWatcher {
    return watchPayment((ref, request) => this.verify(ref, request), reference, handlers, options);
  }
}
