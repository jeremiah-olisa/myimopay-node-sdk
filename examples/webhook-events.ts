// @sdk-owner: A13-docs

/**
 * Event-based payment lifecycle, end to end.
 *
 * Subscribe in the route that creates the payment, then feed every verified
 * webhook into the bus from the webhook route. There is no polling and no
 * timer: a subscription costs one in-memory entry and the bus is idle until
 * `emit` is called.
 *
 * Per-process scope: the bus lives in the process that created it. With more
 * than one instance (cluster, several containers, serverless), the webhook can
 * land on a process that never saw the subscription, and `emit` there returns
 * 0. Either route the delivery to the subscribing instance (sticky sessions, a
 * queue with the reference as the key) or persist the outcome and reconcile it
 * from your own store.
 *
 * The event is a signal, not a ledger: it carries the reference and the
 * terminal status, never a payable amount. Re-read the amount from your own
 * records (or `payments.verify`) before granting value.
 */

import { constructEvent, MyImoPay, type PaymentEvent } from 'myimopay';

/** Examples print to stdout; the SDK itself never writes anywhere. */
function log(message: string): void {
  // biome-ignore lint/suspicious/noConsole: an example prints where an app would log.
  console.log(message);
}

const client = new MyImoPay({
  environment: 'staging',
  publicKey: 'pk_staging_replace_me',
  secretKey: 'sk_staging_replace_me',
  maxAmount: 5000,
});

/** Replace with a value read from your secret manager at boot. */
const WEBHOOK_SECRET = 'whsec_replace_me';

/** The amount you recorded when the order was created. */
async function amountFromOwnStore(reference: string): Promise<number | null> {
  void reference;
  return null;
}

/** Idempotent write, keyed by `reference`, inside one transaction. */
async function grantValue(reference: string, amount: number): Promise<void> {
  void reference;
  void amount;
}

/** Frees the stock or seat held for this order. */
async function releaseReservation(reference: string): Promise<void> {
  void reference;
}

/**
 * Route that creates the payment. Subscribe *before* redirecting the payer, so
 * a fast webhook cannot arrive while nobody is listening.
 */
export async function createPayment(input: {
  reference: string;
  amount: number;
  fullName: string;
  mobile: string;
  email: string;
}): Promise<{ url: string; unsubscribe: () => void }> {
  const payment = await client.payments.initiate({
    amount: input.amount,
    reference: input.reference,
    // `customer.email` is required by default: the provider rejects initiations
    // without one in practice, so the SDK fails locally instead of after the
    // payer has been redirected.
    customer: { fullName: input.fullName, mobile: input.mobile, email: input.email },
    callbackUrl: 'https://shop.example/checkout/return',
  });

  const unsubscribe = client.payments.events.on(
    payment.reference,
    {
      onSuccess: async (event: PaymentEvent) => {
        const expected = await amountFromOwnStore(event.reference);
        if (expected === null) return;
        await grantValue(event.reference, expected);
      },
      onFailed: async (event: PaymentEvent) => {
        await releaseReservation(event.reference);
      },
      onExpired: async (event: PaymentEvent) => {
        await releaseReservation(event.reference);
      },
      // Fires exactly once, always last: succeeded | failed | expired |
      // timeout | cancelled.
      onClose: (outcome) => {
        log(`${payment.reference}: subscription closed (${outcome})`);
      },
    },
    // Optional per-subscription lifetime; the default is 30 minutes.
    { ttlMs: 30 * 60 * 1000 },
  );

  return { url: payment.authorizationUrl, unsubscribe };
}

/**
 * Webhook route. `rawBody` must be the bytes the provider sent, before any
 * JSON parsing. Return the delivery count when you want to tell a duplicate
 * (0) from a real delivery (1 or more).
 */
export async function receiveWebhook(rawBody: string, signature: string | null): Promise<number> {
  const event = constructEvent(rawBody, signature, { secret: WEBHOOK_SECRET });

  // A re-delivered webhook returns 0 and cannot grant value twice: the bus
  // drops the subscription on the first terminal delivery.
  return client.payments.events.emit(event);
}
