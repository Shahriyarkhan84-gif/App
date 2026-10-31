-- Official resellers: people users contact (WhatsApp) to buy diamonds with JazzCash or Easypaisa
-- at a discount. The app only lists them; the payment and the diamonds are handled between the
-- user and the reseller, outside the app. The owner adds, edits and removes resellers.
create table if not exists public.resellers (
  user_id text primary key references public.profiles(id) on delete cascade,
  whatsapp text not null check (whatsapp ~ '^[1-9][0-9]{9,14}$'), -- international digits, e.g. 923001234567
  note text check (char_length(note) <= 80),                       -- e.g. "Lahore · 9am to midnight"
  discount_pct int not null default 30 check (discount_pct between 1 and 90),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- No client access to the table: everyone reads through list_resellers(), only the owner writes.
alter table public.resellers enable row level security;
revoke all on public.resellers from anon, authenticated;

-- Active resellers whose account is in good standing; owners also get the inactive ones.
create or replace function public.list_resellers()
returns table (user_number bigint, display_name text, avatar_url text, whatsapp text, note text,
               discount_pct int, active boolean)
language sql stable security definer set search_path = ''
as $$
  select p.user_number, coalesce(p.display_name, p.username), p.avatar_url, r.whatsapp, r.note, r.discount_pct, r.active
  from public.resellers r join public.profiles p on p.id = r.user_id
  where (r.active and public.user_status(r.user_id) = 'active') or public.is_platform_admin()
  order by r.active desc, r.sort, r.created_at
$$;

create or replace function public.set_reseller(p_user_number bigint, p_whatsapp text, p_note text,
                                               p_discount_pct int default 30, p_active boolean default true)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user text; v_phone text := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select id into v_user from public.profiles where user_number = p_user_number;
  if v_user is null then raise exception 'user_not_found'; end if;
  if v_phone ~ '^03[0-9]{9}$' then v_phone := '92' || substr(v_phone, 2); end if; -- 0300… → 92300…
  if v_phone ~ '^3[0-9]{9}$' then v_phone := '92' || v_phone; end if;              -- 300… → 92300…
  if v_phone !~ '^[1-9][0-9]{9,14}$' then raise exception 'invalid_whatsapp'; end if;
  insert into public.resellers (user_id, whatsapp, note, discount_pct, active)
    values (v_user, v_phone, nullif(btrim(p_note), ''), coalesce(p_discount_pct, 30), coalesce(p_active, true))
  on conflict (user_id) do update set whatsapp = excluded.whatsapp, note = excluded.note,
    discount_pct = excluded.discount_pct, active = excluded.active, updated_at = now();
  perform private.audit('reseller_set', 'user', v_user,
    jsonb_build_object('whatsapp', v_phone, 'discount_pct', coalesce(p_discount_pct, 30), 'active', coalesce(p_active, true)));
end $$;

create or replace function public.remove_reseller(p_user_number bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user text;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  delete from public.resellers r using public.profiles p
   where p.id = r.user_id and p.user_number = p_user_number returning r.user_id into v_user;
  if v_user is null then raise exception 'not_found'; end if;
  perform private.audit('reseller_removed', 'user', v_user, '{}');
end $$;

revoke all on function public.list_resellers(), public.set_reseller(bigint, text, text, int, boolean), public.remove_reseller(bigint)
  from public, anon;
grant execute on function public.list_resellers() to authenticated;
grant execute on function public.set_reseller(bigint, text, text, int, boolean), public.remove_reseller(bigint) to authenticated;
