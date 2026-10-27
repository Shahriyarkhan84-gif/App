-- "No face" rule: when the host's camera shows no face for a while, the host's app pauses the
-- live (camera off) and viewers see "Host will be right back" instead of a black screen.
-- Only the host pauses or resumes their own live; the pause ends with the live. Each pause is
-- audited so moderators can see hosts who are often off camera.

alter table public.rooms add column if not exists host_paused boolean not null default false;

create or replace function public.set_live_paused(p_paused boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_room public.rooms;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into v_room from public.rooms where host_id = uid for update;
  if not found then raise exception 'not_a_host'; end if;
  if v_room.status <> 'live' then raise exception 'not_live'; end if;
  if p_reason is not null and p_reason not in ('no_face', 'host') then raise exception 'invalid_reason'; end if;
  if v_room.host_paused = p_paused then return; end if;
  update public.rooms set host_paused = p_paused, updated_at = now() where id = v_room.id;
  if p_paused then
    perform private.audit('live_paused', 'room', v_room.id::text, jsonb_build_object('reason', coalesce(p_reason, 'host')));
  end if;
end $$;
revoke all on function public.set_live_paused(boolean, text) from public, anon;
grant execute on function public.set_live_paused(boolean, text) to authenticated;

-- A live that ends is never left paused for next time.
create or replace function private.unpause_on_offline()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status <> 'live' then new.host_paused := false; end if;
  return new;
end $$;
drop trigger if exists unpause_on_offline on public.rooms;
create trigger unpause_on_offline before update of status on public.rooms
  for each row execute function private.unpause_on_offline();
