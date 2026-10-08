-- Paid profile frames, bought with coins.
-- Prices live in frame_catalog (never from the client); buy_frame() locks the wallet, dedupes on the
-- buyer's idempotency key, debits through apply_coin_delta and books the coins to the platform
-- ledger in one transaction. Clients only read; ownership and the equipped frame change via RPCs.

create table public.frame_catalog (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 40),
  -- Drawing recipe for the app: {"colors": ["#hex", ...], "glow": "#hex", "icon": "crown" | null}
  style jsonb not null,
  coin_price int not null check (coin_price > 0),
  duration_days int check (duration_days is null or duration_days between 1 and 3650), -- null = permanent
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.user_frames (
  user_id text not null references public.profiles(id) on delete cascade,
  frame_id text not null references public.frame_catalog(id),
  acquired_at timestamptz not null default now(),
  expires_at timestamptz, -- null = permanent
  primary key (user_id, frame_id)
);

create table public.frame_purchases (
  id bigint generated always as identity primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  frame_id text not null references public.frame_catalog(id),
  coins bigint not null check (coins > 0),
  expires_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index frame_purchases_user_idx on public.frame_purchases (user_id, created_at desc);
create index user_frames_frame_idx on public.user_frames (frame_id);

alter table public.profiles add column active_frame_id text references public.frame_catalog(id);
grant select (active_frame_id) on public.profiles to authenticated;

-- Frame purchases are a new kind of coin spend.
alter table public.coin_transactions drop constraint coin_transactions_kind_check;
alter table public.coin_transactions add constraint coin_transactions_kind_check
  check (kind in ('purchase', 'gift_sent', 'refund', 'chargeback', 'adjustment', 'frame_purchase'));

alter table public.frame_catalog enable row level security;
alter table public.user_frames enable row level security;
alter table public.frame_purchases enable row level security;

-- Read-only for clients: purchases and ownership change only through buy_frame / equip_frame.
revoke all on public.frame_catalog, public.user_frames, public.frame_purchases from anon, authenticated;
grant select on public.frame_catalog to anon, authenticated;
grant select on public.user_frames to authenticated;
grant select on public.frame_purchases to authenticated;

create policy "frame catalog" on public.frame_catalog for select to anon, authenticated
  using (active or (select public.is_platform_admin()));
-- Owned frames are visible to everyone (profiles show them); purchases only to the buyer.
create policy "owned frames readable" on public.user_frames for select to authenticated using (true);
create policy "own frame purchases" on public.frame_purchases for select to authenticated
  using (user_id = (select public.requesting_user_id()) or (select public.is_platform_admin()));

-- Buy (or extend) a frame. A retry with the same key returns the first purchase and charges nothing.
create or replace function public.buy_frame(p_frame_id text, p_idempotency_key text)
returns public.frame_purchases language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_wallet public.wallets;
  v_existing public.frame_purchases;
  v_frame public.frame_catalog;
  v_owned public.user_frames;
  v_expires timestamptz;
  v_row public.frame_purchases;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'invalid_idempotency_key';
  end if;

  -- Serializes this user's spends; a concurrent retry waits here, then finds the first purchase.
  v_wallet := private.lock_wallet(uid);

  select * into v_existing from public.frame_purchases where user_id = uid and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if v_wallet.frozen then raise exception 'wallet_frozen'; end if;

  select * into v_frame from public.frame_catalog where id = p_frame_id and active;
  if not found then raise exception 'invalid_frame'; end if;

  select * into v_owned from public.user_frames where user_id = uid and frame_id = p_frame_id for update;
  if found and v_owned.expires_at is null then raise exception 'already_owned'; end if;

  if v_wallet.coin_balance < v_frame.coin_price then raise exception 'insufficient_coins'; end if;

  -- Timed frames: a re-buy adds the duration to whatever time is left.
  v_expires := case when v_frame.duration_days is null then null
                    else greatest(coalesce(v_owned.expires_at, now()), now()) + make_interval(days => v_frame.duration_days) end;

  insert into public.frame_purchases (user_id, frame_id, coins, expires_at, idempotency_key)
    values (uid, p_frame_id, v_frame.coin_price, v_expires, p_idempotency_key)
    returning * into v_row;

  perform private.apply_coin_delta(uid, -v_frame.coin_price::bigint, 'frame_purchase', 'frame_purchase', v_row.id::text, 'frame:' || v_row.id);

  insert into public.user_frames (user_id, frame_id, expires_at) values (uid, p_frame_id, v_expires)
    on conflict (user_id, frame_id) do update set expires_at = excluded.expires_at, acquired_at = now();

  insert into public.platform_ledger (bucket, unit, amount, ref_type, ref_id)
    values ('frame_sales', 'coins', v_frame.coin_price, 'frame_purchase', v_row.id::text);

  return v_row;
end $$;

-- Wear an owned, unexpired frame; null takes it off.
create or replace function public.equip_frame(p_frame_id text)
returns text language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_frame_id is not null and not exists (
    select 1 from public.user_frames
    where user_id = uid and frame_id = p_frame_id and (expires_at is null or expires_at > now())
  ) then
    raise exception 'frame_not_owned';
  end if;
  update public.profiles set active_frame_id = p_frame_id where id = uid;
  return p_frame_id;
end $$;

revoke execute on function public.buy_frame(text, text) from public, anon;
revoke execute on function public.equip_frame(text) from public, anon;
grant execute on function public.buy_frame(text, text) to authenticated;
grant execute on function public.equip_frame(text) to authenticated;

insert into public.frame_catalog (id, name, style, coin_price, duration_days, sort) values
  ('rose_gold', 'Rose Gold', '{"colors": ["#F9A8D4", "#FBCFE8", "#F472B6"], "glow": "#F472B6", "icon": null}', 300, 30, 1),
  ('neon_violet', 'Neon Violet', '{"colors": ["#A855F7", "#6366F1", "#EC4899"], "glow": "#A855F7", "icon": "sparkles"}', 600, 30, 2),
  ('emerald', 'Emerald', '{"colors": ["#10B981", "#34D399", "#065F46"], "glow": "#10B981", "icon": "leaf"}', 600, 30, 3),
  ('fire', 'Fire', '{"colors": ["#F97316", "#EF4444", "#FACC15"], "glow": "#F97316", "icon": "flame"}', 1200, 30, 4),
  ('royal_crown', 'Royal Crown', '{"colors": ["#FACC15", "#F59E0B", "#FDE68A"], "glow": "#F59E0B", "icon": "star"}', 3000, null, 5),
  ('diamond', 'Diamond', '{"colors": ["#67E8F9", "#A5F3FC", "#818CF8"], "glow": "#22D3EE", "icon": "diamond"}', 5000, null, 6)
on conflict (id) do nothing;
