// @sdk-owner: A13-docs

/**
 * Popup checkout, with the two things that actually go wrong handled:
 *
 * 1. The popup is blocked — the payer still needs a link to click.
 * 2. The payer closes the popup — that is a cancellation, not a failure and not
 *    a payment.
 *
 * A popup result is only a status once `verify` (your server) says so. Nothing
 * in the browser bundle decides whether money moved: the server initiates the
 * payment, subscribes to its events, and grants value from the webhook.
 *
 * The two halves belong in separate bundles and are kept in one file only so
 * the flow is readable in one place.
 */

import { isPaid, MyImoPay } from 'myimopay';
import {
  type CheckoutResult,
  createCheckout,
  type VerifiedPayment,
  type WindowLike,
} from 'myimopay-browser';

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

/** Idempotent write, keyed by `reference`. */
async function grantValue(reference: string, amount: number): Promise<void> {
  void reference;
  void amount;
}

async function releaseReservation(reference: string): Promise<void> {
  void reference;
}

export interface PopupOrder {
  /** Your stable, unique reference: max 20 chars of [A-Za-z0-9._-]. */
  reference: string;
  amount: number;
  customerName: string;
  customerMobile: string;
  /** Required by default: the provider rejects initiations without one. */
  customerEmail: string;
}

/**
 * Creates the payment and subscribes before the payer is redirected. The bus is
 * per-process: with several instances, route the webhook to the subscribing one
 * or persist the outcome and reconcile from your own store.
 */
export async function createPopupPayment(
  order: PopupOrder,
): Promise<{ url: string; reference: string; unsubscribe: () => void }> {
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

  const unsubscribe = client.payments.events.on(payment.reference, {
    onSuccess: async (event) => {
      // The event is a signal, not proof of amount: re-read it.
      const verified = await client.payments.verify(event.reference);
      if (verified.status === 'succeeded') {
        await grantValue(verified.reference, verified.amountPaid);
      }
    },
    onFailed: (event) => releaseReservation(event.reference),
    onExpired: (event) => releaseReservation(event.reference),
    onClose: (outcome) => {
      log(`${payment.reference}: subscription closed (${outcome})`);
    },
  });

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

/** Structural anchor element, so this example needs no DOM lib. */
interface AnchorLike {
  href: string;
  hidden: boolean;
}

/** Calls your server, never the gateway. */
async function verifyOnServer(reference: string): Promise<VerifiedPayment> {
  const response = await fetch(`/api/payments/${encodeURIComponent(reference)}`);
  if (!response.ok) throw new Error(`verification failed with ${response.status}`);
  return (await response.json()) as VerifiedPayment;
}

/**
 * `url` and `reference` come from your server's initiate call.
 * `fallbackLink` is any `<a>` on the page; it stays hidden until it is needed.
 */
export async function payInPopup(
  url: string,
  reference: string,
  browserWindow: WindowLike,
  fallbackLink: AnchorLike,
): Promise<CheckoutResult> {
  const checkout = createCheckout({
    mode: 'popup',
    window: browserWindow,
    popupFeatures: 'width=480,height=720',
    timeoutMs: 300_000,
    verify: verifyOnServer,

    // A blocker is not an error: show the same URL as a normal link.
    onBlocked: (blockedUrl) => {
      fallbackLink.href = blockedUrl;
      fallbackLink.hidden = false;
      log('popup blocked; the fallback link is now visible');
    },

    onSuccess: (payment) => {
      log(`paid ${payment.amountPaid} ${payment.currency}`);
    },
    onFailed: (payment) => {
      log(`failed: ${payment.reference}`);
    },
    onExpired: (payment) => {
      log(`expired: ${payment.reference}`);
    },

    // Closed or timed out before a terminal, verified status. Keep the order
    // open and keep checking: a closed popup is not "unpaid".
    onCancelled: () => {
      log('checkout closed before a result; the order stays pending');
    },

    // Verification failed (network, auth, provider). Not a payment failure.
    onError: (error) => {
      log(`could not verify: ${String(error)}`);
    },

    onClose: (result) => {
      log(`popup closed with ${result.outcome}`);
    },
  });

  const result = await checkout.open(url, { reference });

  // The popup never opened, or it was closed without an answer: make sure the
  // payer has a way to continue. `closed` means the window went away before
  // `verify` could answer; `timeout` means we stopped asking.
  if (result.outcome === 'blocked' || result.outcome === 'closed' || result.outcome === 'timeout') {
    fallbackLink.hidden = false;
    if (fallbackLink.href === '') fallbackLink.href = url;
  }

  return result;
}
