-- Host tools sheet (Room tools / Other tools): sticker on the live, comment settings, newcomers
-- list and paid promotion. Only the room's own host changes these, through the functions below.

-- Sticker ------------------------------------------------------------------------------
alter table public.rooms add column if not exists sticker text
  check (sticker is null or sticker in ('🌸', '✨', '💖', '🎉', '👑', '🔥', '🎵', '☕', '🌙', '🌈', '🎂', '🇵🇰'));

create or replace function public.set_live_sticker(p_sticker text)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  update public.rooms set sticker = nullif(p_sticker, ''), updated_at = now() where host_id = uid and status = 'live';
  if not found then raise exception 'not_live'; end if;
exception when check_violation then raise exception 'invalid_sticker';
end $$;

-- Comment settings -----------------------------------------------------------------------
alter table public.rooms add column if not exists chat_mode text not null default 'everyone'
  check (chat_mode in ('everyone', 'followers', 'off'));
alter table public.rooms add column if not exists chat_slow_seconds int not null default 0
  check (chat_slow_seconds in (0, 5, 10, 30));

create or replace function public.set_chat_settings(p_mode text, p_slow_seconds int)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  update public.rooms set chat_mode = p_mode, chat_slow_seconds = p_slow_seconds, updated_at = now() where host_id = uid;
  if not found then raise exception 'not_a_host'; end if;
exception when check_violation then raise exception 'invalid_setting';
end $$;

-- Live chat respects the room's comment settings (the host and room admins can always chat).
create or replace function public.send_chat_message(p_room uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_body text := trim(p_body); v_row public.messages; v_staff boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if char_length(v_body) not between 1 and 300 then raise exception 'invalid_length'; end if;
  select * into v_room from public.rooms where id = p_room;
  if not found or v_room.status <> 'live' then raise exception 'room_not_live'; end if;
  if exists (select 1 from public.room_bans where room_id = p_room and user_id = uid
             and (expires_at is null or expires_at > now())) then
    raise exception 'muted_in_room';
  end if;
  v_staff := v_room.host_id = uid or exists (select 1 from public.room_admins where room_id = p_room and user_id = uid);
  if not v_staff then
    if v_room.chat_mode = 'off' then raise exception 'chat_off'; end if;
    if v_room.chat_mode = 'followers'
       and not exists (select 1 from public.follows where follower_id = uid and followee_id = v_room.host_id) then
      raise exception 'chat_followers_only';
    end if;
    if v_room.chat_slow_seconds > 0 and exists (select 1 from public.messages where sender_id = uid and room_id = p_room
             and created_at > now() - make_interval(secs => v_room.chat_slow_seconds)) then
      raise exception 'chat_slow_mode';
    end if;
  end if;
  -- Anti-spam: at most 5 messages per 10 seconds, and no immediate repeats.
  if (select count(*) from public.messages where sender_id = uid and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from public.messages where sender_id = uid and room_id = p_room and body = v_body
             and created_at > now() - interval '30 seconds') then
    raise exception 'duplicate_message';
  end if;

  v_body := private.filter_text(v_body);
  insert into public.messages (room_id, stream_id, sender_id, body) values (p_room, v_room.current_stream_id, uid, v_body)
    returning * into v_row;
  if (private.setting('ai_moderation') ->> 'mode') = 'all' then
    perform private.enqueue_ai_job('moderate_message', jsonb_build_object('message_id', v_row.id), 'msg:' || v_row.id);
  end if;
  return v_row;
end $$;

-- Newcomers: people watching this live who never watched this host before ---------------------
create or replace function public.live_newcomers()
returns table (user_id text, display_name text, username text, avatar_url text, joined_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select v.user_id, p.display_name, p.username, p.avatar_url, v.joined_at
  from public.rooms r
  join public.viewers v on v.stream_id = r.current_stream_id and v.left_at is null
  join public.profiles p on p.id = v.user_id
  where r.host_id = public.requesting_user_id() and r.status = 'live'
    and not exists (select 1 from public.viewers o join public.streams s on s.id = o.stream_id
                    where o.user_id = v.user_id and s.host_id = r.host_id and s.id <> r.current_stream_id)
  order by v.joined_at desc
  limit 50
$$;

-- Promote: spend diamonds to show the live first on Discover ------------------------------------
alter table public.rooms add column if not exists promoted_until timestamptz;
insert into public.platform_settings (key, value) values ('promotion', '{"coins_per_10_min": 100}') on conflict (key) do nothing;

create table if not exists public.live_promotions (
  id bigint generated always as identity primary key,
  host_id text not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  minutes int not null check (minutes in (10, 30, 60)),
  coins bigint not null check (coins > 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (host_id, idempotency_key)
);
create index if not exists live_promotions_room_idx on public.live_promotions (room_id);
alter table public.live_promotions enable row level security;
drop policy if exists "own promotions" on public.live_promotions;
create policy "own promotions" on public.live_promotions for select to authenticated using (host_id = public.requesting_user_id());
revoke all on public.live_promotions from anon, authenticated;
grant select on public.live_promotions to authenticated;

alter table public.coin_transactions drop constraint if exists coin_transactions_kind_check;
alter table public.coin_transactions add constraint coin_transactions_kind_check
  check (kind in ('purchase', 'gift_sent', 'refund', 'chargeback', 'adjustment', 'frame_purchase', 'promotion'));

create or replace function public.promote_live(p_minutes int, p_idempotency_key text)
returns public.live_promotions language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_wallet public.wallets;
  v_existing public.live_promotions;
  v_room public.rooms;
  v_price bigint;
  v_row public.live_promotions;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_minutes not in (10, 30, 60) then raise exception 'invalid_minutes'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then raise exception 'invalid_idempotency_key'; end if;
  v_wallet := private.lock_wallet(uid);
  select * into v_existing from public.live_promotions where host_id = uid and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if v_wallet.frozen then raise exception 'wallet_frozen'; end if;
  select * into v_room from public.rooms where host_id = uid for update;
  if not found or v_room.status <> 'live' then raise exception 'not_live'; end if;
  v_price := (coalesce((private.setting('promotion') ->> 'coins_per_10_min')::bigint, 100)) * (p_minutes / 10);
  if v_wallet.coin_balance < v_price then raise exception 'insufficient_coins'; end if;
  insert into public.live_promotions (host_id, room_id, minutes, coins, idempotency_key)
    values (uid, v_room.id, p_minutes, v_price, p_idempotency_key) returning * into v_row;
  perform private.apply_coin_delta(uid, -v_price, 'promotion', 'live_promotion', v_row.id::text, 'promo:' || v_row.id);
  update public.rooms set promoted_until = greatest(coalesce(promoted_until, now()), now()) + make_interval(mins => p_minutes)
    where id = v_room.id;
  insert into public.platform_ledger (bucket, unit, amount, ref_type, ref_id) values ('promotion_sales', 'coins', v_price, 'live_promotion', v_row.id::text);
  perform private.audit('live_promoted', 'room', v_room.id::text, jsonb_build_object('minutes', p_minutes, 'coins', v_price));
  return v_row;
end $$;

-- A live that ends stops being promoted and drops its sticker.
create or replace function private.reset_live_extras()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status <> 'live' then new.sticker := null; new.promoted_until := null; end if;
  return new;
end $$;
drop trigger if exists reset_live_extras on public.rooms;
create trigger reset_live_extras before update of status on public.rooms for each row execute function private.reset_live_extras();

revoke all on function public.set_live_sticker(text), public.set_chat_settings(text, int), public.live_newcomers(),
  public.promote_live(int, text) from public, anon;
grant execute on function public.set_live_sticker(text), public.set_chat_settings(text, int), public.live_newcomers(),
  public.promote_live(int, text) to authenticated;
