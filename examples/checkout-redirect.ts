// @sdk-owner: A13-docs

/**
 * Redirect checkout, end to end.
 *
 * The two halves below belong in **separate bundles**: the first runs on your
 * server (it holds the key), the second in the browser (it holds nothing).
 * They are kept in one file only so the whole flow is readable in one place.
 *
 * The redirect flow hands the payer to the provided `authorizationUrl`, and the
 * return page completes the flow with `resume()`. `resume()` never decides a
 * status from the query string: it calls `verify` — your server endpoint — and
 * reports what that says.
 *
 * The server side also subscribes to the payment's events, because the webhook
 * that settles it arrives on the server, not in the browser. The bus is
 * per-process: with several instances, route the webhook to the subscribing one
 * or persist the outcome and reconcile from your own store.
 */

import { isPaid, MyImoPay } from 'myimopay';
import { createCheckout, type VerifiedPayment, type WindowLike } from 'myimopay-browser';

function log(message: string): void {
  // biome-ignore lint/suspicious/noConsole: an example prints where an app would log.
  console.log(message);
}

// --------------------------------------------------------------------------
// Server bundle
// --------------------------------------------------------------------------

const client = new MyImoPay({
  environment: 'staging',
  publicKey: 'pk_staging_replace_me',
  secretKey: 'sk_staging_replace_me',
  maxAmount: 5000,
});

export interface OrderInput {
  /** Your stable, unique reference: max 20 chars of [A-Za-z0-9._-]. */
  reference: string;
  amount: number;
  customerName: string;
  customerMobile: string;
  /** Required by default: the provider rejects initiations without one. */
  customerEmail: string;
}

/** Idempotent write, keyed by `reference`. */
async function grantValue(reference: string, amount: number): Promise<void> {
  void reference;
  void amount;
}

async function releaseReservation(reference: string): Promise<void> {
  void reference;
}

/**
 * Subscribes to the payment's terminal outcome. Call it from the route that
 * creates the payment, before the payer is redirected, so no webhook can arrive
 * with nobody listening. Returns the idempotent unsubscribe.
 */
export function subscribeToOutcome(reference: string): () => void {
  return client.payments.events.on(reference, {
    onSuccess: async (event) => {
      // The event carries a reference and a status, never a payable amount:
      // re-read the amount from your own records or a verification call.
      const verified = await client.payments.verify(event.reference);
      if (verified.status === 'succeeded') {
        await grantValue(verified.reference, verified.amountPaid);
      }
    },
    onFailed: (event) => releaseReservation(event.reference),
    onExpired: (event) => releaseReservation(event.reference),
    onClose: (outcome) => {
      log(`${reference}: subscription closed (${outcome})`);
    },
  });
}

/** POST /api/checkout — creates the payment and returns where to send the payer. */
export async function createCheckoutSession(
  order: OrderInput,
): Promise<{ url: string; reference: string; unsubscribe: () => void }> {
  // `order.reference` is the provider's idempotency key: reuse it when retrying
  // this same payment, never for a different one.
  const payment = await client.payments.initiate({
    amount: order.amount,
    reference: order.reference,
    customer: {
      fullName: order.customerName,
      mobile: order.customerMobile,
      email: order.customerEmail,
    },
    callbackUrl: 'https://shop.example/checkout/return',
  });

  const unsubscribe = subscribeToOutcome(payment.reference);

  return { url: payment.authorizationUrl, reference: payment.reference, unsubscribe };
}

/** POST /webhooks/myimopay — see examples/express-webhook.ts for the raw-body part. */
export async function onWebhook(rawBody: string, signature: string | null): Promise<number> {
  // Unsigned, as the provider sends it. Use { secret } when a proxy signs.
  const event = MyImoPay.webhooks.constructEvent(rawBody, signature, {
    allowUnsigned: true,
  });
  const payment = await client.payments.verify(event.reference);
  if (!isPaid(payment)) return 0;
  return client.payments.events.emit(
    { ...event, status: payment.status },
    { allowUnverified: true },
  );
}

// --------------------------------------------------------------------------
// Browser bundle
// --------------------------------------------------------------------------

/** Calls your server, never the gateway. Replace the URL with your route. */
async function verifyOnServer(reference: string): Promise<VerifiedPayment> {
  const response = await fetch(`/api/payments/${encodeURIComponent(reference)}`);
  if (!response.ok) throw new Error(`verification failed with ${response.status}`);
  return (await response.json()) as VerifiedPayment;
}

/** "Pay now" handler. The page leaves on success; nothing else runs afterwards. */
export async function startCheckout(
  url: string,
  reference: string,
  browserWindow: WindowLike,
): Promise<void> {
  const checkout = createCheckout({
    mode: 'redirect',
    window: browserWindow,
    verify: verifyOnServer,
    onError: (error) => {
      log(`checkout error: ${String(error)}`);
    },
    onClose: (result) => {
      log(`checkout closed: ${result.outcome}`);
    },
  });

  await checkout.open(url, { reference });
}

/**
 * Return page. `href` is the full return URL, and `reference` must come from
 * your own state (session/storage) — not from the query string.
 */
export async function finishCheckout(
  href: string,
  reference: string,
  browserWindow: WindowLike,
): Promise<void> {
  const checkout = createCheckout({
    window: browserWindow,
    verify: verifyOnServer,
    onReturn: (hint) => {
      // `hint.verified` is false: render "confirming", not "paid".
      log(`returned for ${hint.reference ?? 'an unknown reference'}`);
      if (!hint.referenceMatches) log('this return does not match the expected order');
    },
    onSuccess: (payment) => {
      log(`paid ${payment.amountPaid} ${payment.currency}`);
    },
    onFailed: () => {
      log('payment failed');
    },
    onExpired: () => {
      log('payment link expired');
    },
    onCancelled: () => {
      log('still unconfirmed; show a neutral message');
    },
    onError: (error) => {
      log(`could not verify: ${String(error)}`);
    },
    onClose: (result) => {
      log(`finished with ${result.outcome}`);
    },
  });

  await checkout.resume(href, { reference, expectedReference: reference });
}
