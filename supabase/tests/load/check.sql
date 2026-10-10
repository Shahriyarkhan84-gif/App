-- Money invariants after the run: every coin a viewer lost is a recorded gift, nobody went negative.
\set ON_ERROR_STOP 1
do $$
declare spent bigint; gifted bigint; neg int;
begin
  select sum(1000000 - coin_balance) into spent from public.wallets where user_id like 'u%';
  select coalesce(sum(coins_total), 0) into gifted from public.gifts;
  select count(*) into neg from public.wallets where coin_balance < 0;
  raise notice 'coins spent by viewers: %, coins in gifts: %, negative wallets: %', spent, gifted, neg;
  if spent <> gifted then raise exception 'LOAD CHECK FAILED: viewers lost % coins but gifts total %', spent, gifted; end if;
  if neg > 0 then raise exception 'LOAD CHECK FAILED: % negative wallets', neg; end if;
end $$;
select count(*) as gifts, (select count(*) from public.messages) as chat_messages from public.gifts;
