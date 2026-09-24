-- Hardening from the Supabase security advisor.

-- Fixed search_path on every function (the rest already set it).
alter function public.requesting_user_id() set search_path = '';
alter function private.enforce_room_admin_limit() set search_path = '';

-- is_agency_admin_of_user was created after the blanket revoke in the access
-- migration, so Supabase's default privileges made it callable by anon.
revoke execute on function public.is_agency_admin_of_user(text) from public, anon;

-- Future functions in public: no execute for anon/public by default; grant explicitly.
alter default privileges in schema public revoke execute on functions from public, anon;
