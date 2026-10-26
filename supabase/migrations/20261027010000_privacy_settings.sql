-- Settings → Privacy and Settings → Notifications.
-- who_can_message: everyone / people you follow / nobody, enforced in send_direct_message().
-- hide_from_nearby: your lives don't appear in other people's Nearby feed.
-- notification_settings.muted: optional notification groups a person switched off; account,
-- payment and safety notices can't be muted.

alter table public.profiles add column if not exists who_can_message text not null default 'everyone'
  check (who_can_message in ('everyone', 'followers', 'nobody'));
alter table public.profiles add column if not exists hide_from_nearby boolean not null default false;
grant update (who_can_message, hide_from_nearby) on public.profiles to authenticated;

create table if not exists public.notification_settings (
  user_id text primary key references public.profiles(id) on delete cascade,
  muted text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
drop policy if exists "own notification settings" on public.notification_settings;
create policy "own notification settings" on public.notification_settings for select to authenticated
  using (user_id = public.requesting_user_id());
revoke all on public.notification_settings from anon, authenticated;
grant select on public.notification_settings to authenticated;

-- Only these groups can be muted.
create or replace function private.notification_group(p_type text)
returns text language sql immutable set search_path = ''
as $$ select case when p_type like 'pk_battle%' then 'pk_battles' when p_type = 'event_reward' then 'events' end $$;

create or replace function public.set_notification_muted(p_group text, p_muted boolean)
returns text[] language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v text[];
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_group not in ('pk_battles', 'events') then raise exception 'not_mutable'; end if;
  insert into public.notification_settings (user_id, muted) values (uid, '{}') on conflict (user_id) do nothing;
  update public.notification_settings
     set muted = case when p_muted then array(select distinct unnest(muted || p_group)) else array_remove(muted, p_group) end,
         updated_at = now()
   where user_id = uid
  returning muted into v;
  return v;
end $$;
revoke all on function public.set_notification_muted(text, boolean) from public, anon;
grant execute on function public.set_notification_muted(text, boolean) to authenticated;

-- Notifications skip groups the person muted.
create or replace function private.notify(p_user text, p_type text, p_title text, p_body text, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_group text := private.notification_group(p_type);
begin
  if v_group is not null
     and exists (select 1 from public.notification_settings where user_id = p_user and v_group = any(muted)) then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, data) values (p_user, p_type, p_title, p_body, p_data);
end $$;

-- Direct messages respect the recipient's "who can message me" choice.
create or replace function public.send_direct_message(p_recipient text, p_body text)
returns public.direct_messages language plpgsql security definer set search_path = ''
as $$
declare uid text := public.requesting_user_id(); v_body text := trim(p_body); v_row public.direct_messages;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if public.user_status(uid) <> 'active' then raise exception 'account_restricted'; end if;
  if char_length(v_body) not between 1 and 1000 then raise exception 'invalid_length'; end if;
  if exists (select 1 from public.user_blocks
             where (blocker_id = p_recipient and blocked_id = uid) or (blocker_id = uid and blocked_id = p_recipient)) then
    raise exception 'blocked';
  end if;
  case (select who_can_message from public.profiles where id = p_recipient)
    when 'nobody' then raise exception 'messages_off';
    when 'followers' then
      if not exists (select 1 from public.follows where follower_id = p_recipient and followee_id = uid) then
        raise exception 'messages_followers_only';
      end if;
    else null;
  end case;
  if (select count(*) from public.direct_messages where sender_id = uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow_down';
  end if;
  if not exists (select 1 from public.follows where follower_id = p_recipient and followee_id = uid)
     and not exists (select 1 from public.direct_messages where sender_id = p_recipient and recipient_id = uid)
     and (select count(*) from public.direct_messages where sender_id = uid and recipient_id = p_recipient) >= 3 then
    raise exception 'wait_for_reply';
  end if;
  insert into public.direct_messages (sender_id, recipient_id, body) values (uid, p_recipient, private.filter_text(v_body))
    returning * into v_row;
  return v_row;
end $$;
