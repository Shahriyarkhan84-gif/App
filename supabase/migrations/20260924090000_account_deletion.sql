-- Account deletion (Google Play / App Store requirement).
-- Removes personal data and social graph, anonymises the profile, and keeps
-- financial and moderation records (payments, ledger, gifts, earnings,
-- withdrawals, reports, audit logs) that must be retained by law.
-- Called only by the service role: the delete-account edge function (user
-- request, then Clerk deletion) and the clerk-webhook (user.deleted).

alter table public.profiles add column deleted_at timestamptz;
grant select (deleted_at) on public.profiles to authenticated;

create or replace function public.internal_delete_account(p_user text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('deleted', false, 'reason', 'not_found'); end if;
  if v.deleted_at is not null then return jsonb_build_object('deleted', true, 'already', true); end if;

  -- Money owed to the host must be settled (or rejected) first.
  if exists (select 1 from public.withdrawals where host_id = p_user and status in ('requested', 'approved')) then
    raise exception 'withdrawal_pending';
  end if;

  -- Stop broadcasting and hosting.
  update public.streams set ended_at = now() where host_id = p_user and ended_at is null;
  update public.rooms set status = 'offline', viewer_count = 0, updated_at = now() where host_id = p_user and status = 'live';
  update public.hosts set status = 'suspended' where user_id = p_user;

  -- Personal data and social graph.
  delete from public.follows where follower_id = p_user or followee_id = p_user;
  delete from public.user_blocks where blocker_id = p_user or blocked_id = p_user;
  delete from public.direct_messages where sender_id = p_user or recipient_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.user_recommendations where user_id = p_user;
  delete from public.room_admins where user_id = p_user;
  update public.messages set body = '[deleted]', status = 'hidden' where sender_id = p_user;
  update public.support_tickets set subject = '[deleted]', body = '[deleted]', ai_reply = null where user_id = p_user;

  update public.profiles
    set username = null, display_name = 'Deleted user', avatar_url = null, bio = null, email = null,
        country = null, verified_at = null, status = 'banned', status_until = null, deleted_at = now()
    where id = p_user;

  perform private.audit('account_deleted', 'user', p_user, '{}', 'system');
  return jsonb_build_object('deleted', true);
end $$;

revoke execute on function public.internal_delete_account(text) from public, anon, authenticated;
grant execute on function public.internal_delete_account(text) to service_role;
