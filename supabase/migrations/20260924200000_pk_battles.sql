-- PK battles: two live hosts battle head-to-head. Each host keeps publishing
-- to their own existing LiveKit room (no room merge, no changes to
-- livekit-token) — viewers on either side just also subscribe as a viewer to
-- the opponent's room while the battle is live, and the app renders both
-- feeds side by side. Score is a live tally of gift coins sent to each side
-- while the battle is live, kept in sync by a trigger on `gifts` so the
-- money-critical send_gift() function itself is untouched.

create table public.pk_battles (
  id uuid primary key default gen_random_uuid(),
  room_a_id uuid not null references public.rooms(id) on delete cascade,
  room_b_id uuid not null references public.rooms(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'live', 'declined', 'cancelled', 'ended')),
  score_a bigint not null default 0 check (score_a >= 0),
  score_b bigint not null default 0 check (score_b >= 0),
  winner_room_id uuid references public.rooms(id),
  invited_at timestamptz not null default now(),
  started_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  check (room_a_id <> room_b_id)
);
create index pk_battles_room_a_idx on public.pk_battles (room_a_id);
create index pk_battles_room_b_idx on public.pk_battles (room_b_id);

-- Which battle (if any) each room is currently in — one at a time, checked by
-- the RPCs below. Lets RLS/UI answer "am I in a battle" in O(1) off `rooms`,
-- same pattern as `rooms.current_stream_id`.
alter table public.rooms add column current_battle_id uuid references public.pk_battles(id) on delete set null;

insert into public.platform_settings (key, value) values ('pk_battle', '{"duration_seconds": 180}')
  on conflict (key) do nothing;

-- RPCs ------------------------------------------------------------------------

-- The caller's own live room challenges another live room. Both must be live,
-- different hosts, and neither already in a battle.
create or replace function public.invite_pk_battle(p_target_room_id uuid)
returns public.pk_battles language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_my_room public.rooms;
  v_target public.rooms;
  v_row public.pk_battles;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;

  select * into v_my_room from public.rooms where host_id = uid for update;
  if not found or v_my_room.status <> 'live' then raise exception 'not_live'; end if;
  if v_my_room.current_battle_id is not null then raise exception 'already_in_battle'; end if;

  if p_target_room_id is null then raise exception 'invalid_target'; end if;
  select * into v_target from public.rooms where id = p_target_room_id for update;
  if not found or v_target.status <> 'live' then raise exception 'target_not_live'; end if;
  if v_target.host_id = uid then raise exception 'cannot_battle_self'; end if;
  if v_target.current_battle_id is not null then raise exception 'target_already_in_battle'; end if;

  insert into public.pk_battles (room_a_id, room_b_id) values (v_my_room.id, v_target.id) returning * into v_row;
  update public.rooms set current_battle_id = v_row.id where id in (v_my_room.id, v_target.id);

  perform private.notify(v_target.host_id, 'pk_battle_invite', 'PK battle invite',
    'A host wants to battle you live.', jsonb_build_object('battle_id', v_row.id, 'room_id', v_my_room.id));
  perform private.audit('pk_battle_invited', 'pk_battle', v_row.id::text,
    jsonb_build_object('room_a', v_my_room.id, 'room_b', v_target.id));
  return v_row;
end $$;

-- The challenged host accepts or declines. The challenger (room_a's host) may
-- also cancel their own pending invite (p_accept must be false for them).
create or replace function public.respond_pk_battle(p_battle_id uuid, p_accept boolean)
returns public.pk_battles language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v public.pk_battles;
  v_room_a public.rooms;
  v_room_b public.rooms;
  v_duration int;
  v_is_challenger boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into v from public.pk_battles where id = p_battle_id for update;
  if not found or v.status <> 'invited' then raise exception 'not_invitable'; end if;
  select * into v_room_a from public.rooms where id = v.room_a_id;
  select * into v_room_b from public.rooms where id = v.room_b_id;
  v_is_challenger := v_room_a.host_id = uid;
  if v_room_b.host_id <> uid and not v_is_challenger then raise exception 'forbidden'; end if;
  if v_is_challenger and p_accept then raise exception 'forbidden'; end if; -- challenger can only cancel, not self-accept

  if p_accept then
    v_duration := coalesce((private.setting('pk_battle') ->> 'duration_seconds')::int, 180);
    update public.pk_battles set status = 'live', started_at = now(), ends_at = now() + make_interval(secs => v_duration)
      where id = p_battle_id returning * into v;
    perform private.notify(v_room_a.host_id, 'pk_battle_accepted', 'Battle accepted',
      'Your PK battle is live.', jsonb_build_object('battle_id', v.id));
  else
    update public.pk_battles set status = case when v_is_challenger then 'cancelled' else 'declined' end
      where id = p_battle_id returning * into v;
    update public.rooms set current_battle_id = null where id in (v.room_a_id, v.room_b_id);
    perform private.notify(case when v_is_challenger then v_room_b.host_id else v_room_a.host_id end,
      'pk_battle_' || v.status, initcap(v.status) || ' battle', null, jsonb_build_object('battle_id', v.id));
  end if;
  perform private.audit('pk_battle_' || v.status, 'pk_battle', v.id::text);
  return v;
end $$;

-- Either host can end early; anyone (including the AI/cron worker) can end it
-- once the clock has run out. Winner = higher score; ties are null.
create or replace function public.end_pk_battle(p_battle_id uuid)
returns public.pk_battles language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v public.pk_battles;
  v_host_a text;
  v_host_b text;
begin
  select * into v from public.pk_battles where id = p_battle_id for update;
  if not found or v.status <> 'live' then raise exception 'not_live'; end if;
  select host_id into v_host_a from public.rooms where id = v.room_a_id;
  select host_id into v_host_b from public.rooms where id = v.room_b_id;
  if now() < v.ends_at and uid not in (v_host_a, v_host_b) and not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  update public.pk_battles set status = 'ended', ended_at = now(),
    winner_room_id = case when score_a = score_b then null when score_a > score_b then room_a_id else room_b_id end
    where id = p_battle_id returning * into v;
  update public.rooms set current_battle_id = null where id in (v.room_a_id, v.room_b_id);

  perform private.notify(v_host_a, 'pk_battle_ended', 'Battle ended',
    case when v.winner_room_id is null then 'It''s a tie.'
         when v.winner_room_id = v.room_a_id then 'You won!' else 'You lost this one.' end,
    jsonb_build_object('battle_id', v.id));
  perform private.notify(v_host_b, 'pk_battle_ended', 'Battle ended',
    case when v.winner_room_id is null then 'It''s a tie.'
         when v.winner_room_id = v.room_b_id then 'You won!' else 'You lost this one.' end,
    jsonb_build_object('battle_id', v.id));
  perform private.audit('pk_battle_ended', 'pk_battle', v.id::text,
    jsonb_build_object('score_a', v.score_a, 'score_b', v.score_b, 'winner_room_id', v.winner_room_id));
  return v;
end $$;

-- Score trigger -----------------------------------------------------------------
-- Every gift already goes through send_gift()'s ledgered, security-definer
-- path; this only reads the (already-final) coins_total and adds it to
-- whichever side of an in-progress battle that room belongs to. It never
-- touches wallets, earnings or the ledger.
create or replace function private.pk_battle_apply_gift_score()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.rooms;
  v_battle public.pk_battles;
begin
  select * into v_room from public.rooms where id = new.room_id;
  if v_room.current_battle_id is null then return new; end if;
  select * into v_battle from public.pk_battles where id = v_room.current_battle_id and status = 'live';
  if not found then return new; end if;

  if v_room.id = v_battle.room_a_id then
    update public.pk_battles set score_a = score_a + new.coins_total where id = v_battle.id;
  else
    update public.pk_battles set score_b = score_b + new.coins_total where id = v_battle.id;
  end if;
  return new;
end $$;

create trigger pk_battle_gift_score after insert on public.gifts
  for each row execute function private.pk_battle_apply_gift_score();

-- Access ------------------------------------------------------------------------

revoke all on public.pk_battles from anon, authenticated;
grant select on public.pk_battles to authenticated;
alter table public.pk_battles enable row level security;
create policy "pk battles public" on public.pk_battles for select to authenticated using (true);

revoke execute on function public.invite_pk_battle(uuid) from public, anon;
grant execute on function public.invite_pk_battle(uuid) to authenticated;
revoke execute on function public.respond_pk_battle(uuid, boolean) from public, anon;
grant execute on function public.respond_pk_battle(uuid, boolean) to authenticated;
revoke execute on function public.end_pk_battle(uuid) from public, anon;
grant execute on function public.end_pk_battle(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pk_battles;
  end if;
end $$;
