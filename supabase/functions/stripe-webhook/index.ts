// Stripe webhook → keeps public.subscriptions in sync and sends Resend emails.
// Subscribe to: checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted
import type Stripe from 'npm:stripe@18';

import { json, requireEnv } from '../_shared/cors.ts';
import { emails, sendEmail } from '../_shared/email.ts';
import { cryptoProvider, getStripe } from '../_shared/stripe.ts';
import { adminClient } from '../_shared/supabase.ts';

const ACTIVE = ['active', 'trialing'];

Deno.serve(async (req) => {
  const stripe = getStripe();
  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature ?? '',
      requireEnv('STRIPE_WEBHOOK_SECRET'),
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error('Bad signature', err);
    return json({ error: 'Invalid signature' }, 400);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && typeof session.subscription === 'string') {
          await sync(stripe, await stripe.subscriptions.retrieve(session.subscription));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await sync(stripe, event.data.object);
        break;
    }
  } catch (err) {
    console.error('Webhook handling failed', err);
    return json({ error: 'Handler failed' }, 500); // Stripe will retry
  }

  return json({ received: true });
});

async function sync(stripe: Stripe, sub: Stripe.Subscription) {
  const db = adminClient();
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  let userId = sub.metadata?.clerk_user_id;
  if (!userId) {
    const { data } = await db.from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    userId = data?.user_id;
  }
  if (!userId) {
    console.warn('No user for customer', customerId);
    return;
  }

  const { data: previous } = await db.from('subscriptions').select('status').eq('user_id', userId).maybeSingle();

  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null;

  const { error } = await db.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: item?.price.id ?? null,
    current_period_end: periodEnd,
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  const wasActive = !!previous && ACTIVE.includes(previous.status);
  const isActive = ACTIVE.includes(sub.status);
  if (wasActive === isActive) return;

  const customer = await stripe.customers.retrieve(customerId);
  const email = !customer.deleted ? customer.email : null;
  if (!email) return;

  const message = isActive
    ? emails.subscriptionStarted(periodEnd ? new Date(periodEnd).toDateString() : 'your next billing date')
    : emails.subscriptionCanceled();
  await sendEmail({ to: email, ...message });
}
