import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  readonly client: Stripe;

  constructor(private readonly config: ConfigService) {
    this.client = new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'));
  }

  createCheckoutSession(payment: { id: string; coins: bigint; amountMinor: bigint; currency: string }) {
    return this.client.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: payment.currency,
            unit_amount: Number(payment.amountMinor),
            product_data: { name: `${payment.coins} Zynalive coins` },
          },
        },
      ],
      metadata: { payment_id: payment.id },
      success_url: this.config.getOrThrow<string>('STRIPE_SUCCESS_URL'),
      cancel_url: this.config.getOrThrow<string>('STRIPE_CANCEL_URL'),
    });
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.client.webhooks.constructEvent(rawBody, signature, this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'));
  }
}
