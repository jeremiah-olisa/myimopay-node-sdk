// @sdk-owner: A13-docs

/**
 * Express webhook endpoint.
 *
 * Mount it with a raw body parser, never with `express.json()`:
 *
 *   app.post('/webhooks/myimopay', express.raw({ type: 'application/json' }), handle);
 *
 * The digest is computed over the exact bytes the provider sent, so the body
 * must still be unparsed when `constructEvent` sees it. `req.body` is then a
 * Buffer; `assertRawBodyString` accepts it and rejects a pre-parsed object
 * instead of silently failing open.
 *
 * The delivery is authenticated, then emitted into `payments.events`, where the
 * subscriber that created the payment is waiting. A webhook is a trigger, not
 * proof of amount: the subscriber re-reads the amount from its own records (or
 * calls `payments.verify`) before granting value.
 */

import {
  assertRawBodyString,
  constructEvent,
  MyImoPay,
  MyImoPayWebhookError,
  type WebhookEvent,
} from 'myimopay';

// Structural Express types, so this file needs no `express` dependency.
interface RequestLike {
  /** `express.raw(...)` leaves the raw bytes here. */
  body: unknown;
  header(name: string): string | undefined;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

/** Replace with a value read from your secret manager at boot. */
const WEBHOOK_SECRET = 'whsec_replace_me';

const client = new MyImoPay({
  environment: 'staging',
  publicKey: 'pk_staging_replace_me',
  secretKey: 'sk_staging_replace_me',
  maxAmount: 5000,
});

export async function handle(req: RequestLike, res: ResponseLike): Promise<void> {
  const rawBody = assertRawBodyString(req.body);
  let event: WebhookEvent;

  try {
    event = constructEvent(rawBody, req.header('x-myimopay-signature'), {
      secret: WEBHOOK_SECRET,
    });
  } catch (error) {
    if (error instanceof MyImoPayWebhookError) {
      // Unsigned, malformed or tampered with. Process nothing.
      res.status(401).json({ received: false });
      return;
    }
    throw error;
  }

  // Delivers to every subscriber of this reference in *this* process and closes
  // them. A re-delivered webhook returns 0 and grants nothing a second time.
  // With several instances the delivery may land elsewhere: route it to the
  // subscribing instance, or persist the outcome and reconcile later.
  const delivered = await client.payments.events.emit(event);

  // Always acknowledge an authentic delivery: subscriber failures are
  // swallowed by the bus, so there is nothing here for the provider to retry.
  res.status(200).json({ received: true, delivered });
}
