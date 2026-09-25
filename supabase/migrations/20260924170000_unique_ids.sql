-- Every user has their own ID; no two users can ever share or merge one.
-- Already enforced: profiles.user_number is UNIQUE and frozen after sign-up;
-- hosts.host_code is UNIQUE and always copied from the host's own profile.
-- This closes the last gap: two sign-ups at the same moment drawing the same
-- random number. Issuing a number now takes a transaction-scoped lock, so the
-- "is it free?" check and the insert can't interleave between sign-ups.
-- Deleted accounts keep their (anonymised) profile row, so an ID is never reused.

create or replace function private.new_user_number() returns bigint
language plpgsql volatile set search_path = ''
as $$
declare v bigint;
begin
  perform pg_advisory_xact_lock(hashtext('zynalive.user_number'));
  loop
    v := 10000000 + floor(random() * 90000000)::bigint;
    exit when not exists (select 1 from public.profiles where user_number = v);
  end loop;
  return v;
end $$;

-- One host row per user, and a Host ID can belong to only one host.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.hosts'::regclass and contype in ('p', 'u')
                 and conkey = array[(select attnum from pg_attribute where attrelid = 'public.hosts'::regclass and attname = 'user_id')]) then
    alter table public.hosts add constraint hosts_user_id_key unique (user_id);
  end if;
end $$;
