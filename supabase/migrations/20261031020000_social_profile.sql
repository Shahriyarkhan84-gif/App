-- Social profile: a photo gallery (up to 6, the first is the cover), profile visitors, and one
-- read for the public profile's numbers (fans, following, friends, beans received, diamonds sent,
-- VIP progress, visitors, the host's agency name). Writes only through the RPCs below.

-- Photo gallery ---------------------------------------------------------------------------------
create table if not exists public.profile_photos (
  id bigint generated always as identity primary key,
  user_id text not null references public.profiles(id) on delete cascade,
  path text not null,
  url text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, path)
);
create index if not exists profile_photos_user_idx on public.profile_photos (user_id, position, id);
alter table public.profile_photos enable row level security;
revoke all on public.profile_photos from anon, authenticated;
grant select on public.profile_photos to authenticated;
drop policy if exists "profile photos are public" on public.profile_photos;
create policy "profile photos are public" on public.profile_photos for select to authenticated using (true);

-- Same folder and file rules as set_avatar(): your own avatars/<id>/ folder, an image that exists.
create or replace function public.add_profile_photo(p_path text)
returns public.profile_photos language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_base text := private.setting('media') ->> 'avatars_base';
  v_exists boolean := true;
  v public.profile_photos;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> uid or p_path !~ '^[^/]+/[A-Za-z0-9._-]{1,80}\.(jpg|jpeg|png|webp)$' then
    raise exception 'invalid_photo';
  end if;
  if v_base is null then raise exception 'not_configured'; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v_exists using 'avatars', p_path;
  end if;
  if not v_exists then raise exception 'invalid_photo'; end if;
  perform 1 from public.profiles where id = uid for update; -- one add at a time, so the limit holds
  if (select count(*) from public.profile_photos where user_id = uid) >= 6 then raise exception 'photo_limit'; end if;
  insert into public.profile_photos (user_id, path, url, position)
    values (uid, p_path, rtrim(v_base, '/') || '/' || p_path,
            coalesce((select max(position) + 1 from public.profile_photos where user_id = uid), 0))
    returning * into v;
  return v;
end $$;

create or replace function public.remove_profile_photo(p_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  delete from public.profile_photos where id = p_id and (user_id = uid or public.is_platform_admin());
  if not found then raise exception 'not_found'; end if;
end $$;

-- Moves a photo to the front (it becomes the cover).
create or replace function public.set_cover_photo(p_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profile_photos where id = p_id and user_id = uid) then raise exception 'not_found'; end if;
  update public.profile_photos set position = case when id = p_id then 0 else position + 1 end where user_id = uid;
end $$;

-- A deleted account's photos go with it (the profile row is kept, anonymised).
create or replace function private.clear_photos_on_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.profile_photos where user_id = new.id;
    delete from public.profile_views where user_id = new.id or viewer_id = new.id;
  end if;
  return null;
end $$;

-- Visitors --------------------------------------------------------------------------------------
-- One visit per viewer per day; nobody can read who visited (only the count, through profile_card).
create table if not exists public.profile_views (
  user_id text not null references public.profiles(id) on delete cascade,
  viewer_id text not null references public.profiles(id) on delete cascade,
  day date not null default current_date,
  primary key (user_id, viewer_id, day)
);
alter table public.profile_views enable row level security;
revoke all on public.profile_views from anon, authenticated;

create or replace function public.record_profile_view(p_user text)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id();
begin
  if uid is null or p_user is null or uid = p_user then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is null) then return; end if;
  insert into public.profile_views (user_id, viewer_id) values (p_user, uid) on conflict do nothing;
end $$;

drop trigger if exists clear_photos_on_delete on public.profiles;
create trigger clear_photos_on_delete after update of deleted_at on public.profiles
  for each row execute function private.clear_photos_on_delete();

-- The public profile's numbers --------------------------------------------------------------------
create or replace function public.profile_card(p_user text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_agency text; v_host boolean;
begin
  if public.requesting_user_id() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is null) then return null; end if;
  select true, a.name into v_host, v_agency
    from public.hosts h left join public.agencies a on a.id = h.agency_id and a.status = 'active'
   where h.user_id = p_user;
  return jsonb_build_object(
    'fans', (select count(*) from public.follows where followee_id = p_user),
    'following', (select count(*) from public.follows where follower_id = p_user),
    'friends', (select count(*) from public.follows f where f.followee_id = p_user
                  and exists (select 1 from public.follows b where b.follower_id = p_user and b.followee_id = f.follower_id)),
    'beans', coalesce((select lifetime from public.creator_earnings where host_id = p_user), 0),
    'diamonds_sent', coalesce((select sum(coins_total - clawed_coins) from public.gifts where sender_id = p_user), 0),
    -- VIP level comes from diamonds bought, net of refunds and chargebacks (same rule as the VIP page).
    'diamonds_bought', greatest(0, coalesce((select sum(delta) from public.coin_transactions
                  where user_id = p_user and kind in ('purchase', 'refund', 'chargeback')), 0)),
    'visitors', (select count(*) from public.profile_views where user_id = p_user),
    'is_host', coalesce(v_host, false),
    'agency', v_agency
  );
end $$;

revoke all on function public.add_profile_photo(text), public.remove_profile_photo(bigint), public.set_cover_photo(bigint),
  public.record_profile_view(text), public.profile_card(text) from public, anon;
grant execute on function public.add_profile_photo(text), public.remove_profile_photo(bigint), public.set_cover_photo(bigint),
  public.record_profile_view(text), public.profile_card(text) to authenticated;
revoke all on function private.clear_photos_on_delete() from public, anon, authenticated;
