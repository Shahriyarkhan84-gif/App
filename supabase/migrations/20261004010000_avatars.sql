-- Profile photos (Edit profile → Change photo). Public `avatars` bucket; every
-- signed-in user can write only their own folder (<clerk user id>/…).
-- profiles.avatar_url was already user-writable through its column grant.

-- Storage bucket + policies (skipped where the storage schema doesn't exist, e.g. the local test database).
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute $p$drop policy if exists "users upload own avatar" on storage.objects$p$;
  execute $p$drop policy if exists "users replace own avatar" on storage.objects$p$;
  execute $p$drop policy if exists "users delete own avatar" on storage.objects$p$;
  execute $p$create policy "users upload own avatar" on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.requesting_user_id())$p$;
  execute $p$create policy "users replace own avatar" on storage.objects for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.requesting_user_id())$p$;
  execute $p$create policy "users delete own avatar" on storage.objects for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.requesting_user_id())$p$;
end $$;
