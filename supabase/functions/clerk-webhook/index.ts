// Clerk webhook (user.created / user.updated / user.deleted), verified with Svix.
// Mirrors identity fields into public.profiles — never roles — and sends a
// Resend welcome email on sign-up.
import { Webhook } from 'npm:svix@1';

import { json, requireEnv } from '../_shared/cors.ts';
import { emails, sendEmail } from '../_shared/email.ts';
import { adminClient } from '../_shared/supabase.ts';

type ClerkUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string }[];
};

Deno.serve(async (req) => {
  const body = await req.text();
  let event: { type: string; data: ClerkUser };
  try {
    event = new Webhook(requireEnv('CLERK_WEBHOOK_SECRET')).verify(body, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }) as typeof event;
  } catch {
    return json({ error: { code: 'invalid_signature', message: 'Invalid signature' } }, 400);
  }

  const db = adminClient();
  const user = event.data;

  if (event.type === 'user.deleted') {
    // Deleted in Clerk (dashboard or delete-account): remove personal data, keep financial/audit history.
    const { error } = await db.rpc('internal_delete_account', { p_user: user.id });
    if (error) {
      // e.g. withdrawal_pending: still strip identity fields; staff settle the rest.
      console.error('internal_delete_account failed', error.message);
      await db.from('profiles').update({ email: null, display_name: 'Deleted user', avatar_url: null }).eq('id', user.id);
    }
    return json({ ok: true });
  }

  if (event.type === 'user.created' || event.type === 'user.updated') {
    const email =
      user.email_addresses?.find((e) => e.id === user.primary_email_address_id)?.email_address ??
      user.email_addresses?.[0]?.email_address ??
      null;
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;

    const { error } = await db
      .from('profiles')
      .upsert({ id: user.id, email, display_name: name, avatar_url: user.image_url }, { onConflict: 'id' });
    if (error) {
      console.error('profile upsert failed', error);
      return json({ error: { code: 'internal', message: 'Upsert failed' } }, 500);
    }
    await db.from('wallets').upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });

    if (event.type === 'user.created' && email) await sendEmail({ to: email, ...emails.welcome(user.first_name ?? '') });
  }

  return json({ ok: true });
});
