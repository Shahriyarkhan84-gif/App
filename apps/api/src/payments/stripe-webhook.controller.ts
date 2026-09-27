import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import { Prisma } from '@zynalive/database';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';

import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

/**
 * Separate from PaymentsController because this route needs the raw request
 * body (for Stripe's signature check) instead of the parsed JSON every other
 * route gets — see main.ts's `rawBody: true`.
 */
@Controller('payments/webhook')
export class StripeWebhookController {
  constructor(
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('stripe')
  async handle(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) throw new BadRequestException('Missing raw body');

    let event: Stripe.Event;
    try {
      event = this.stripe.constructWebhookEvent(req.rawBody, signature);
    } catch {
      throw new BadRequestException('Invalid signature');
    }

    // Replay protection: each provider event is processed at most once.
    try {
      await this.prisma.processedWebhookEvent.create({ data: { provider: 'stripe', eventId: event.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw err;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.payments.creditPayment(
          session.id,
          typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? ''),
          BigInt(session.amount_total ?? 0),
          session.currency ?? 'pkr',
        );
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (intent) await this.payments.refundPayment(intent);
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const intent = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
        if (intent) await this.payments.disputePayment(intent, 'opened');
        break;
      }
      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute;
        const intent = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
        if (intent) await this.payments.disputePayment(intent, dispute.status === 'won' ? 'won' : 'lost');
        break;
      }
      default:
        break;
    }

    return { received: true };
  }
}
