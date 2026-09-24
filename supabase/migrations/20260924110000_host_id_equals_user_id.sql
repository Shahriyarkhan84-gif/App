-- One ID per person: a host's Host ID is the same 8-digit number as their
-- user ID (profiles.user_number). Set by the database, never by clients.

alter table public.hosts alter column host_code drop default;

create or replace function private.hosts_host_code() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select user_number::text into new.host_code from public.profiles where id = new.user_id;
  else
    new.host_code := old.host_code;
  end if;
  return new;
end $$;

-- Existing hosts take their user ID.
update public.hosts h set host_code = p.user_number::text
  from public.profiles p where p.id = h.user_id;

create trigger hosts_host_code
  before insert or update on public.hosts
  for each row execute function private.hosts_host_code();

alter table public.hosts
  add constraint hosts_host_code_is_user_id check (host_code ~ '^[1-9][0-9]{7}$');

drop sequence if exists public.host_code_seq;
