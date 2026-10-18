-- Android APK for zynalive.com/download (vercel.json redirects /download/android to it). Public
-- `downloads` bucket: anyone can read through its public URL. Only the service role writes (the
-- apk-publish Edge Function), so there are no insert/update/delete policies for app users.

-- Storage bucket (skipped where the storage schema doesn't exist, e.g. the local test database).
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('downloads', 'downloads', true, 314572800, array['application/vnd.android.package-archive', 'application/json'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
end $$;

-- Which EAS build the website offers. apk-publish copies this link into the bucket; owners change
-- it (here or in the command center's settings) after each new preview build.
insert into public.platform_settings (key, value)
values ('android_apk', jsonb_build_object('source', 'https://expo.dev/artifacts/eas/Zdy6kiGBlSXaD2_7-vFTbLEH8EvBoJtRq2-AdyZkQ20.apk'))
on conflict (key) do nothing;
