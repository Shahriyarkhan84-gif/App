-- Each agency owner gets one agency with a one-time, permanent 4-digit code.
-- Codes are issued once on insert and can never change; one agency per owner.

drop function if exists public.regenerate_agency_code(uuid);

create or replace function private.freeze_agency_code() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.code is distinct from old.code then raise exception 'agency_code_permanent'; end if;
  return new;
end $$;

create trigger agencies_code_permanent before update of code on public.agencies
  for each row execute function private.freeze_agency_code();

create unique index agencies_one_per_owner on public.agencies (manager_id) where manager_id is not null;
