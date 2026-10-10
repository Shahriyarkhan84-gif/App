-- Money invariants after the run: every coin a viewer lost is a recorded gift, nobody went negative,
-- and (after folding the last tallies) hosts and streams hold exactly what the gifts say.
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
-- Fold whatever tallies the last gifts left, then every host must hold exactly their share.
do $$
declare t record; earned bigint; shares bigint; stream_total bigint; gifted bigint;
begin
  for t in select distinct kind, target from private.gift_tallies loop
    perform private.fold_tally(t.kind, t.target, true);
  end loop;
  select sum(balance) into earned from public.creator_earnings;
  select sum(host_share) into shares from public.gifts;
  select sum(gift_coins) into stream_total from public.streams;
  select sum(coins_total) into gifted from public.gifts;
  raise notice 'host earnings: % = host shares: %; stream totals: % = coins gifted: %', earned, shares, stream_total, gifted;
  if earned <> shares then raise exception 'LOAD CHECK FAILED: hosts hold % but their shares total %', earned, shares; end if;
  if stream_total <> gifted then raise exception 'LOAD CHECK FAILED: streams show % coins but gifts total %', stream_total, gifted; end if;
end $$;
-- The PK battle (h1 vs h2, live since the seed) scored every gift either side received.
do $$
declare v public.pk_battles; ga bigint; gb bigint;
begin
  select * into v from public.pk_battles where status = 'live' limit 1;
  if v.id is null then return; end if;
  select coalesce(sum(coins_total), 0) into ga from public.gifts where room_id = v.room_a_id;
  select coalesce(sum(coins_total), 0) into gb from public.gifts where room_id = v.room_b_id;
  raise notice 'PK battle: score % : %, gifts % : %', v.score_a, v.score_b, ga, gb;
  if v.score_a <> ga or v.score_b <> gb then raise exception 'LOAD CHECK FAILED: PK score %:% but gifts %:%', v.score_a, v.score_b, ga, gb; end if;
end $$;
select count(*) as gifts, (select count(*) from public.messages) as chat_messages from public.gifts;
