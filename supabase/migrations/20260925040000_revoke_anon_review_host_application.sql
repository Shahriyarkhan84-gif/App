-- Security advisor (0028): review_host_application() was created in
-- …120000_host_applications.sql without revoking the default EXECUTE from
-- anon, so signed-out callers could reach it (it still rejected them with
-- `forbidden` inside, but they shouldn't get that far). Admin-only RPC.
revoke execute on function public.review_host_application(uuid, boolean, text) from public, anon;
grant execute on function public.review_host_application(uuid, boolean, text) to authenticated;
