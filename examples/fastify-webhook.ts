// @sdk-owner: A13-docs

/**
 * Fastify webhook endpoint.
 *
 * Fastify parses `application/json` by default. Register a buffer parser so the
 * raw bytes survive:
 *
 *   app.addContentTypeParser(
 *     'application/json',
 *     { parseAs: 'buffer' },
 *     (_request, body, done) => done(null, body),
 *   );
 *   app.post('/webhooks/myimopay', handle);
 *
 * `constructEvent` takes `string | Uint8Array`, so the Buffer can go straight in
 * without a decode. Nothing here trusts the delivery: the HMAC is checked
 * first, then the event is emitted to the subscriber that created the payment.
 * That subscriber — not this handler — decides whether money actually moved.
 */

import { constructEvent, MyImoPay, MyImoPayWebhookError, type WebhookEvent } from 'myimopay';

// Structural Fastify types, so this file needs no `fastify` dependency.
interface FastifyRequestLike {
  /** A Buffer, because of the `parseAs: 'buffer'` parser above. */
  body: unknown;
  headers: Record<string, string | undefined>;
}

interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike;
  send(payload: unknown): void;
}

/** Replace with a value read from your secret manager at boot. */
const WEBHOOK_SECRET = 'whsec_replace_me';

const client = new MyImoPay({
  environment: 'staging',
  publicKey: 'pk_staging_replace_me',
  secretKey: 'sk_staging_replace_me',
  maxAmount: 5000,
});

export async function handle(request: FastifyRequestLike, reply: FastifyReplyLike): Promise<void> {
  const body = request.body;

  if (!(body instanceof Uint8Array)) {
    // The body parser was overridden somewhere. Refuse rather than guess.
    reply.code(415).send({ received: false, reason: 'raw body required' });
    return;
  }

  const signature = request.headers['x-myimopay-signature'];
  let event: WebhookEvent;

  try {
    event = constructEvent(body, signature, { secret: WEBHOOK_SECRET });
  } catch (error) {
    if (error instanceof MyImoPayWebhookError) {
      reply.code(401).send({ received: false });
      return;
    }
    throw error;
  }

  // The bus is per-process. A delivery that lands on an instance without the
  // subscription returns 0; route webhooks to the subscribing instance or
  // persist the outcome and reconcile from your own store.
  const delivered = await client.payments.events.emit(event);

  reply.code(200).send({ received: true, delivered });
}
