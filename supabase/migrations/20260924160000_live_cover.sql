-- A cover picture is required to go live. Covers live in the public `covers`
-- storage bucket under the host's own folder (<clerk user id>/…); hosts can
-- only write their own folder, and rooms.cover_url is only ever set by
-- set_room_cover(), which builds the URL from a server-side base so a client
-- can't point a room at an arbitrary image.

-- Public base URL of the storage bucket, e.g.
-- https://<project>.supabase.co/storage/v1/object/public/covers
insert into public.platform_settings (key, value) values ('media', '{"covers_base": null}')
on conflict (key) do nothing;

-- Storage bucket + policies (skipped where the storage schema doesn't exist, e.g. the local test database).
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('covers', 'covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute $p$drop policy if exists "hosts upload own covers" on storage.objects$p$;
  execute $p$drop policy if exists "hosts replace own covers" on storage.objects$p$;
  execute $p$drop policy if exists "hosts delete own covers" on storage.objects$p$;
  execute $p$create policy "hosts upload own covers" on storage.objects for insert to authenticated
    with check (bucket_id = 'covers' and (storage.foldername(name))[1] = public.requesting_user_id()
                and exists (select 1 from public.hosts h where h.user_id = public.requesting_user_id()))$p$;
  execute $p$create policy "hosts replace own covers" on storage.objects for update to authenticated
    using (bucket_id = 'covers' and (storage.foldername(name))[1] = public.requesting_user_id())$p$;
  execute $p$create policy "hosts delete own covers" on storage.objects for delete to authenticated
    using (bucket_id = 'covers' and (storage.foldername(name))[1] = public.requesting_user_id())$p$;
end $$;

-- Sets the caller's room cover from a file they uploaded to covers/<their id>/<file>.
create or replace function public.set_room_cover(p_path text)
returns public.rooms language plpgsql security definer set search_path = ''
as $$
declare
  uid text := public.requesting_user_id();
  v_base text := private.setting('media') ->> 'covers_base';
  v_exists boolean := true;
  v_room public.rooms;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if not exists (select 1 from public.hosts where user_id = uid) then raise exception 'not_a_host'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> uid or p_path !~ '^[^/]+/[A-Za-z0-9._-]{1,80}\.(jpg|jpeg|png|webp)$' then
    raise exception 'invalid_cover';
  end if;
  if v_base is null then raise exception 'not_configured'; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v_exists using 'covers', p_path;
  end if;
  if not v_exists then raise exception 'invalid_cover'; end if;

  update public.rooms set cover_url = rtrim(v_base, '/') || '/' || p_path, updated_at = now()
    where host_id = uid returning * into v_room;
  if not found then raise exception 'not_a_host'; end if;
  return v_room;
end $$;

-- go_live: unchanged except a cover is now required.
create or replace function public.go_live(p_title text, p_category text default 'chat')
returns public.rooms language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms; v_stream uuid;
begin
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  select * into v_room from public.rooms where host_id = uid for update;
  if not found or not exists (select 1 from public.hosts where user_id = uid and status = 'active') then
    raise exception 'not_a_host';
  end if;
  if private.host_verification_required('go_live')
     and (select verification_status from public.hosts where user_id = uid) <> 'approved' then
    raise exception 'verification_required';
  end if;
  if v_room.status = 'live' then return v_room; end if;
  if nullif(v_room.cover_url, '') is null then raise exception 'cover_required'; end if;
  insert into public.streams (room_id, host_id, title) values (v_room.id, uid, coalesce(nullif(trim(p_title), ''), 'Live now'))
    returning id into v_stream;
  update public.rooms set status = 'live', title = coalesce(nullif(trim(p_title), ''), 'Live now'),
    category = p_category, current_stream_id = v_stream, viewer_count = 0, updated_at = now()
    where id = v_room.id returning * into v_room;
  insert into public.notifications (user_id, type, title, body, data)
    select f.follower_id, 'live', coalesce(p.display_name, p.username, 'A host you follow') || ' is live',
           v_room.title, jsonb_build_object('room_id', v_room.id)
    from public.follows f join public.profiles p on p.id = uid
    where f.followee_id = uid;
  return v_room;
end $$;

revoke execute on function public.set_room_cover(text) from public, anon;
grant execute on function public.set_room_cover(text) to authenticated;
