-- Grants + Row Level Security. Principle: clients read through RLS and write
-- only where a policy explicitly allows it; everything involving money, roles
-- or moderation goes through the security-definer RPCs above.

-- Settings admin RPC --------------------------------------------------------------
create or replace function public.set_platform_setting(p_key text, p_value jsonb)
returns public.platform_settings language plpgsql security definer set search_path = ''
as $$
declare v public.platform_settings;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  update public.platform_settings set value = p_value, updated_at = now() where key = p_key returning * into v;
  if not found then raise exception 'not_found'; end if;
  perform private.audit('setting_changed', 'setting', p_key, p_value);
  return v;
end $$;

-- Table privileges ------------------------------------------------------------------
-- Supabase grants ALL on new tables to anon/authenticated by default. Start from
-- nothing and grant back only what the app needs.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.rooms, public.gift_catalog, public.coin_packages to anon;

grant select on
  public.agencies, public.agency_members, public.hosts, public.rooms, public.streams, public.room_admins,
  public.room_bans, public.viewers, public.follows, public.user_blocks, public.messages, public.direct_messages,
  public.notifications, public.audit_logs, public.platform_settings, public.wallets, public.coin_transactions,
  public.gift_catalog, public.gifts, public.creator_earnings, public.earning_entries, public.platform_ledger,
  public.coin_packages, public.payments, public.refund_requests, public.withdrawals, public.reports,
  public.moderation_actions, public.ai_jobs, public.ai_reports, public.ai_actions, public.message_translations,
  public.support_tickets, public.user_recommendations, public.word_filters
to authenticated;

-- Profiles: email is private; role/status are never client-writable.
grant select (id, username, display_name, avatar_url, bio, country, language, role, status, status_until, created_at)
  on public.profiles to authenticated;
grant update (username, display_name, avatar_url, bio, country, language) on public.profiles to authenticated;

grant insert, delete on public.follows, public.user_blocks to authenticated;
grant update (read_at) on public.notifications, public.direct_messages to authenticated;

-- Function privileges -------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- internal_* functions: service role only (edge functions + AI worker).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'internal\_%' loop
    execute format('revoke execute on function %s from authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Row Level Security ----------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Helper: is the host in an agency the caller administers?
create or replace function public.is_agency_admin_of_user(p_user text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.hosts h where h.user_id = p_user
                 and h.agency_id in (select public.admin_agency_ids()))
$$;
grant execute on function public.is_agency_admin_of_user(text) to authenticated;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own profile editable" on public.profiles for update to authenticated
  using (id = public.requesting_user_id()) with check (id = public.requesting_user_id());

-- Agency isolation: members only see their own agency.
create policy "agency visible to members" on public.agencies for select to authenticated
  using (public.is_platform_admin() or id in (select public.member_agency_ids()));
create policy "agency members visible to members" on public.agency_members for select to authenticated
  using (public.is_platform_admin() or agency_id in (select public.member_agency_ids()));

create policy "hosts public" on public.hosts for select to authenticated using (true);
create policy "rooms public" on public.rooms for select to anon, authenticated using (true);
create policy "streams public" on public.streams for select to authenticated using (true);
create policy "room admins public" on public.room_admins for select to authenticated using (true);
create policy "room bans visible to target and moderators" on public.room_bans for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin()
         or exists (select 1 from public.rooms r where r.id = room_id and r.host_id = public.requesting_user_id())
         or exists (select 1 from public.room_admins a where a.room_id = room_bans.room_id and a.user_id = public.requesting_user_id()));
create policy "viewers visible to host" on public.viewers for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin()
         or exists (select 1 from public.streams s where s.id = stream_id and s.host_id = public.requesting_user_id()));

create policy "follows public" on public.follows for select to authenticated using (true);
create policy "follow as self" on public.follows for insert to authenticated with check (follower_id = public.requesting_user_id());
create policy "unfollow as self" on public.follows for delete to authenticated using (follower_id = public.requesting_user_id());
create policy "own blocks" on public.user_blocks for select to authenticated using (blocker_id = public.requesting_user_id());
create policy "block as self" on public.user_blocks for insert to authenticated with check (blocker_id = public.requesting_user_id());
create policy "unblock as self" on public.user_blocks for delete to authenticated using (blocker_id = public.requesting_user_id());

create policy "chat visible" on public.messages for select to authenticated
  using (status = 'visible' or sender_id = public.requesting_user_id() or public.is_platform_admin()
         or exists (select 1 from public.rooms r where r.id = room_id and r.host_id = public.requesting_user_id()));
create policy "dm participants" on public.direct_messages for select to authenticated
  using (public.requesting_user_id() in (sender_id, recipient_id));
create policy "dm mark read" on public.direct_messages for update to authenticated
  using (recipient_id = public.requesting_user_id()) with check (recipient_id = public.requesting_user_id());
create policy "word filters admin" on public.word_filters for select to authenticated using (public.is_platform_admin());

create policy "own notifications" on public.notifications for select to authenticated using (user_id = public.requesting_user_id());
create policy "mark notifications read" on public.notifications for update to authenticated
  using (user_id = public.requesting_user_id()) with check (user_id = public.requesting_user_id());
create policy "audit admin" on public.audit_logs for select to authenticated using (public.is_platform_admin());
create policy "settings readable" on public.platform_settings for select to authenticated using (true);

-- Money: owner of the record, platform admins, and (for hosts) their agency admins.
create policy "own wallet" on public.wallets for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin());
create policy "own coin ledger" on public.coin_transactions for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin());
create policy "gift catalog" on public.gift_catalog for select to anon, authenticated using (active or public.is_platform_admin());
create policy "gifts public" on public.gifts for select to authenticated using (true);
create policy "earnings" on public.creator_earnings for select to authenticated
  using (host_id = public.requesting_user_id() or public.is_platform_admin() or public.is_agency_admin_of_user(host_id));
create policy "earning entries" on public.earning_entries for select to authenticated
  using (host_id = public.requesting_user_id() or public.is_platform_admin() or public.is_agency_admin_of_user(host_id));
create policy "platform ledger admin" on public.platform_ledger for select to authenticated using (public.is_platform_admin());
create policy "coin packages" on public.coin_packages for select to anon, authenticated using (active);
create policy "own payments" on public.payments for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin());
create policy "own refund requests" on public.refund_requests for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin());
create policy "withdrawals" on public.withdrawals for select to authenticated
  using (host_id = public.requesting_user_id() or public.is_platform_admin() or public.is_agency_admin_of_user(host_id));

create policy "reports" on public.reports for select to authenticated
  using (reporter_id = public.requesting_user_id() or public.is_platform_admin() or public.is_agency_admin_of_user(target_user_id));
create policy "moderation actions" on public.moderation_actions for select to authenticated
  using (target_user_id = public.requesting_user_id() or public.is_platform_admin() or public.is_agency_admin_of_user(target_user_id));

create policy "ai jobs admin" on public.ai_jobs for select to authenticated using (public.is_platform_admin());
create policy "ai reports admin" on public.ai_reports for select to authenticated using (public.is_platform_admin());
create policy "ai actions admin" on public.ai_actions for select to authenticated using (public.is_platform_admin());
create policy "translations readable" on public.message_translations for select to authenticated using (true);
create policy "own tickets" on public.support_tickets for select to authenticated
  using (user_id = public.requesting_user_id() or public.is_platform_admin());
create policy "own recommendations" on public.user_recommendations for select to authenticated
  using (user_id = public.requesting_user_id());

-- Realtime ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.rooms, public.gifts,
      public.notifications, public.direct_messages, public.message_translations, public.wallets, public.streams;
  end if;
end $$;
