// Clerk webhook (user.created / user.updated / user.deleted), verified with Svix.
// Mirrors users into public.profiles and sends a Resend welcome email.
import { Webhook } from 'npm:svix@1';

import { json, requireEnv } from '../_shared/cors.ts';
import { emails, sendEmail } from '../_shared/email.ts';
import { adminClient } from '../_shared/supabase.ts';

type ClerkUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string }[];
};

type ClerkEvent = { type: string; data: ClerkUser };

Deno.serve(async (req) => {
  const body = await req.text();
  let event: ClerkEvent;
  try {
    event = new Webhook(requireEnv('CLERK_WEBHOOK_SECRET')).verify(body, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }) as ClerkEvent;
  } catch {
    return json({ error: 'Invalid signature' }, 400);
  }

  const db = adminClient();
  const user = event.data;

  if (event.type === 'user.deleted') {
    await db.from('profiles').delete().eq('id', user.id);
    return json({ ok: true });
  }

  if (event.type === 'user.created' || event.type === 'user.updated') {
    const email =
      user.email_addresses?.find((e) => e.id === user.primary_email_address_id)?.email_address ??
      user.email_addresses?.[0]?.email_address ??
      null;
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');

    const { error } = await db.from('profiles').upsert({ id: user.id, email, display_name: name || null });
    if (error) return json({ error: error.message }, 500);

    if (event.type === 'user.created' && email) {
      await sendEmail({ to: email, ...emails.welcome(user.first_name ?? '') });
    }
  }

  return json({ ok: true });
});
