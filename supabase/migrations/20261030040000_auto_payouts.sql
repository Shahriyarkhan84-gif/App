-- Automatic host payouts: a host's withdrawal is approved and sent without an admin when it is
-- small, goes to an account that was already paid once, and nothing about the host looks wrong.
-- Everything else waits for an owner exactly as before.
--
-- Flow: request_withdrawal() inserts the row → withdrawal_auto_approve (before insert) approves it
-- when private.auto_payout_block() finds nothing → the database pings payouts-send (pg_net) →
-- payouts-send claims it (status 'sending'), asks the payout provider to send the money and reports
-- back with internal_payout_result(): paid, back in the queue for another try, or handed to the
-- owner (auto off, payout_error set) who can retry it, pay by hand or reject it (beans go back).
--
-- Off until the owner turns it on: platform_settings.payouts.auto = true and a provider is named
-- (the provider's keys are Edge Function secrets, never in the database or the app).

alter table public.withdrawals drop constraint if exists withdrawals_status_check;
alter table public.withdrawals add constraint withdrawals_status_check
  check (status in ('requested', 'approved', 'sending', 'rejected', 'paid'));
alter table public.withdrawals
  add column if not exists auto boolean not null default false,
  add column if not exists payout_attempts int not null default 0,
  add column if not exists sending_since timestamptz,
  add column if not exists payout_error text;
create index if not exists withdrawals_payout_queue_idx on public.withdrawals (created_at)
  where auto and status in ('approved', 'sending');

insert into public.platform_settings (key, value) values
  ('payouts', '{"auto": false, "provider": null, "max_auto_pkr": 25000, "daily_auto_pkr": 100000, "max_attempts": 3}')
on conflict (key) do nothing;

-- Set once per project (SQL editor), like private.push_config:
--   insert into private.payout_config (url, secret) values ('https://<project-ref>.supabase.co/functions/v1/payouts-send', '<random secret>');
create table if not exists private.payout_config (
  id boolean primary key default true check (id),
  url text not null,
  secret text not null check (char_length(secret) >= 24)
);

-- Wakes payouts-send. The request carries nothing but the secret: what to pay comes from the database.
create or replace function private.payout_dispatch()
returns void language plpgsql security definer set search_path = ''
as $$
declare c private.payout_config;
begin
  select * into c from private.payout_config;
  if not found then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using c.url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-payout-secret', c.secret);
exception when others then
  null; -- the host's Earnings screen and the owner's retry wake it again
end $$;

-- One spelling per account: no spaces or dashes, upper case, mobile numbers as 03XXXXXXXXX.
create or replace function private.payout_account_key(p text)
returns text language sql immutable set search_path = ''
as $$ select regexp_replace(upper(regexp_replace(coalesce(p, ''), '[\s-]', '', 'g')), '^\+?92(3[0-9]{9})$', '0\1') $$;

-- Why a withdrawal can't be paid automatically (null = it can).
create or replace function private.auto_payout_block(p_host text, p_amount_minor bigint, p_method jsonb)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare cfg jsonb := coalesce(private.setting('payouts'), '{}');
begin
  if not coalesce((cfg ->> 'auto')::boolean, false) or coalesce(cfg ->> 'provider', '') = '' then return 'auto_off'; end if;
  if p_amount_minor > coalesce((cfg ->> 'max_auto_pkr')::numeric, 0) * 100 then return 'over_limit'; end if;
  if p_amount_minor + coalesce((select sum(amount_minor) from public.withdrawals
        where host_id = p_host and auto and status in ('approved', 'sending', 'paid')
          and created_at > now() - interval '24 hours'), 0)
     > coalesce((cfg ->> 'daily_auto_pkr')::numeric, 0) * 100 then
    return 'over_daily_limit';
  end if;
  -- A new payout account is checked by a person once; after one paid withdrawal it's trusted.
  if not exists (select 1 from public.withdrawals where host_id = p_host and status = 'paid'
                   and payout_method ->> 'type' = p_method ->> 'type'
                   and private.payout_account_key(payout_method ->> 'account')
                     = private.payout_account_key(p_method ->> 'account')) then
    return 'new_account';
  end if;
  if exists (select 1 from public.moderation_actions where target_user_id = p_host
               and action = 'account_review' and created_at > now() - interval '30 days') then
    return 'under_review';
  end if;
  if exists (select 1 from public.wallets where user_id = p_host and frozen) then return 'wallet_frozen'; end if;
  return null;
end $$;

-- request_withdrawal() already moved the beans to "held" with the host's earnings row locked, so
-- approving here is the same bookkeeping as review_withdrawal(approve) and the daily limit can't race.
create or replace function private.withdrawal_auto_approve()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'requested' or private.auto_payout_block(new.host_id, new.amount_minor, new.payout_method) is not null then
    return new;
  end if;
  update public.creator_earnings set held = held - new.coins, updated_at = now() where host_id = new.host_id;
  new.status := 'approved';
  new.auto := true;
  new.review_note := 'Approved automatically';
  perform private.audit('withdrawal_approved', 'withdrawal', new.id::text,
    jsonb_build_object('coins', new.coins, 'auto', true), 'system');
  return new;
end $$;
drop trigger if exists withdrawal_auto_approve on public.withdrawals;
create trigger withdrawal_auto_approve before insert on public.withdrawals
  for each row execute function private.withdrawal_auto_approve();

create or replace function private.withdrawal_dispatch()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- New automatic payouts and the owner's retries. A payout put back for another try waits for the
  -- next wake-up (another payout, the host's Earnings screen, the owner), not an instant loop.
  if new.auto and new.status = 'approved' and (tg_op = 'INSERT' or not old.auto) then perform private.payout_dispatch(); end if;
  return null;
end $$;
drop trigger if exists withdrawal_dispatch on public.withdrawals;
create trigger withdrawal_dispatch after insert or update of auto on public.withdrawals
  for each row execute function private.withdrawal_dispatch();

-- payouts-send takes the next payouts to send. With the database's secret it takes anyone's; without
-- it, only those of the signed-in host it names (the Earnings screen's safety net). A payout stuck
-- in 'sending' for 15 minutes (the function died mid-way) is taken again: providers are called with
-- the withdrawal id as their idempotency key, so a second call never pays twice.
create or replace function public.internal_claim_payouts(p_secret text, p_host text, p_limit int default 20)
returns setof public.withdrawals language plpgsql security definer set search_path = ''
as $$
-- At least 2 tries: a retried payout keeps 1 attempt on record and must still be takeable.
declare v_max int := greatest(coalesce((private.setting('payouts') ->> 'max_attempts')::int, 3), 2); v_stuck public.withdrawals;
begin
  if p_secret is null and p_host is null then raise exception 'forbidden'; end if;
  if p_secret is not null and not exists (select 1 from private.payout_config where secret = p_secret) then
    raise exception 'forbidden';
  end if;
  -- Stuck in 'sending' after the last try: never taken again automatically; the owner retries it.
  for v_stuck in
    update public.withdrawals
       set status = 'approved', auto = false, payout_error = 'no_answer_from_provider', sending_since = null, updated_at = now()
     where auto and status = 'sending' and sending_since < now() - interval '15 minutes' and payout_attempts >= v_max
       and (p_host is null or host_id = p_host)
    returning *
  loop
    perform private.audit('withdrawal_payout_failed', 'withdrawal', v_stuck.id::text,
      jsonb_build_object('error', v_stuck.payout_error, 'attempts', v_stuck.payout_attempts), 'system');
    perform private.notify(v_stuck.host_id, 'withdrawal', 'Withdrawal delayed',
      'Your payout needs a quick check by our team. Your beans are safe.', jsonb_build_object('withdrawal_id', v_stuck.id));
  end loop;
  return query
  update public.withdrawals w
     set status = 'sending', payout_attempts = w.payout_attempts + 1, sending_since = now(), updated_at = now()
   where w.id in (
     select q.id from public.withdrawals q
      where q.auto and (p_host is null or q.host_id = p_host)
        and ((q.status = 'approved' and q.payout_attempts < v_max)
             or (q.status = 'sending' and q.sending_since < now() - interval '15 minutes' and q.payout_attempts < v_max))
      order by q.created_at
      limit greatest(1, least(coalesce(p_limit, 20), 50))
      for update skip locked)
  returning w.*;
end $$;

-- What the provider said. ok → paid. A temporary failure goes back in the queue until max_attempts;
-- anything else goes to the owner (auto off), who retries it, pays by hand or rejects it.
create or replace function public.internal_payout_result(p_id uuid, p_ok boolean, p_ref text, p_error text, p_retry boolean)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare v public.withdrawals; v_max int := greatest(coalesce((private.setting('payouts') ->> 'max_attempts')::int, 3), 2);
begin
  select * into v from public.withdrawals where id = p_id and status = 'sending' for update;
  if not found then raise exception 'not_found'; end if;
  if p_ok then
    if coalesce(btrim(p_ref), '') = '' then raise exception 'invalid_ref'; end if;
    update public.withdrawals set status = 'paid', payout_ref = left(p_ref, 200), payout_error = null,
      sending_since = null, updated_at = now() where id = v.id returning * into v;
    insert into public.earning_entries (host_id, delta, kind, ref_id) values (v.host_id, 0, 'withdrawal_paid', v.id::text);
    perform private.audit('withdrawal_paid', 'withdrawal', v.id::text,
      jsonb_build_object('payout_ref', v.payout_ref, 'auto', true), 'system');
    perform private.notify(v.host_id, 'withdrawal', 'Withdrawal paid', 'Your payout has been sent.', jsonb_build_object('withdrawal_id', v.id));
  elsif p_retry and v.payout_attempts < v_max then
    update public.withdrawals set status = 'approved', payout_error = left(p_error, 300), sending_since = null, updated_at = now()
      where id = v.id returning * into v;
  else
    -- A refusal on the first try (nothing was ever sent) clears the attempts, so the owner may also
    -- pay by hand or reject. After an unanswered try the provider may still pay, so only a retry
    -- (same id) is allowed.
    update public.withdrawals set status = 'approved', auto = false, payout_error = left(coalesce(p_error, 'payout_failed'), 300),
      payout_attempts = case when p_retry or payout_attempts > 1 then payout_attempts else 0 end,
      sending_since = null, updated_at = now() where id = v.id returning * into v;
    perform private.audit('withdrawal_payout_failed', 'withdrawal', v.id::text,
      jsonb_build_object('error', v.payout_error, 'attempts', v.payout_attempts), 'system');
    perform private.notify(v.host_id, 'withdrawal', 'Withdrawal delayed',
      'Your payout needs a quick check by our team. Your beans are safe.', jsonb_build_object('withdrawal_id', v.id));
  end if;
  return v;
end $$;

-- Owner: send a failed automatic payout again (back in the queue; a payout the provider was already
-- asked about keeps one attempt on record, so it still can't be paid by hand or rejected).
create or replace function public.retry_payout(p_withdrawal_id uuid)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare v public.withdrawals;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.withdrawals set auto = true, payout_attempts = least(payout_attempts, 1), payout_error = null, updated_at = now()
   where id = p_withdrawal_id and status = 'approved' and not auto and payout_error is not null
   returning * into v;
  if not found then raise exception 'not_found'; end if;
  perform private.audit('withdrawal_payout_retry', 'withdrawal', v.id::text, '{}');
  return v;
end $$;

-- An owner pays by hand or rejects only payouts out of the automatic queue that the provider was
-- never asked about (a payout the sender may still pay, or the provider may still complete, must
-- not be paid twice or have its beans returned).
create or replace function public.mark_withdrawal_paid(p_withdrawal_id uuid, p_payout_ref text)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare v public.withdrawals;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_payout_ref), '') = '' then raise exception 'invalid_ref'; end if;
  update public.withdrawals set status = 'paid', payout_ref = left(btrim(p_payout_ref), 200), payout_error = null, updated_at = now()
    where id = p_withdrawal_id and status = 'approved' and not auto and payout_attempts = 0 returning * into v;
  if not found then raise exception 'not_found'; end if;
  insert into public.earning_entries (host_id, delta, kind, ref_id) values (v.host_id, 0, 'withdrawal_paid', v.id::text);
  perform private.audit('withdrawal_paid', 'withdrawal', v.id::text, jsonb_build_object('payout_ref', p_payout_ref));
  perform private.notify(v.host_id, 'withdrawal', 'Withdrawal paid', 'Your payout has been sent.', jsonb_build_object('withdrawal_id', v.id));
  return v;
end $$;

create or replace function public.review_withdrawal(p_withdrawal_id uuid, p_approve boolean, p_note text default null)
returns public.withdrawals language plpgsql security definer set search_path = ''
as $$
declare v public.withdrawals; v_was text;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select * into v from public.withdrawals where id = p_withdrawal_id
    and (status = 'requested' or (status = 'approved' and not auto and payout_attempts = 0 and not p_approve)) for update;
  if not found then raise exception 'not_found'; end if;
  v_was := v.status;
  perform 1 from public.creator_earnings where host_id = v.host_id for update;
  if p_approve then
    update public.creator_earnings set held = held - v.coins, updated_at = now() where host_id = v.host_id;
  elsif v_was = 'requested' then
    update public.creator_earnings set held = held - v.coins, balance = balance + v.coins, updated_at = now()
      where host_id = v.host_id;
    insert into public.earning_entries (host_id, delta, kind, ref_id) values (v.host_id, v.coins, 'withdrawal_release', v.id::text);
  else
    -- Already approved (coins left "held"): the failed payout's coins return to the balance.
    update public.creator_earnings set balance = balance + v.coins, updated_at = now() where host_id = v.host_id;
    insert into public.earning_entries (host_id, delta, kind, ref_id) values (v.host_id, v.coins, 'withdrawal_release', v.id::text);
  end if;
  update public.withdrawals set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = public.requesting_user_id(), review_note = p_note, updated_at = now()
    where id = v.id returning * into v;
  perform private.audit('withdrawal_' || v.status, 'withdrawal', v.id::text, jsonb_build_object('coins', v.coins, 'was', v_was));
  perform private.notify(v.host_id, 'withdrawal', 'Withdrawal ' || v.status, p_note, jsonb_build_object('withdrawal_id', v.id));
  return v;
end $$;

revoke all on function private.auto_payout_block(text, bigint, jsonb), private.payout_dispatch() from public, anon, authenticated;
revoke all on function public.internal_claim_payouts(text, text, int), public.internal_payout_result(uuid, boolean, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.internal_claim_payouts(text, text, int), public.internal_payout_result(uuid, boolean, text, text, boolean)
  to service_role;
revoke all on function public.retry_payout(uuid) from public, anon;
grant execute on function public.retry_payout(uuid) to authenticated;
