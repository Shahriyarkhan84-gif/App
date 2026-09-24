do $$ begin
  if (select coin_balance from public.wallets where user_id = 'c_viewer') <> 90 then
    raise exception 'TEST FAILED: concurrent duplicate gifts charged % coins', 100 - (select coin_balance from public.wallets where user_id = 'c_viewer');
  end if;
  if (select count(*) from public.gifts where sender_id = 'c_viewer') <> 1 then
    raise exception 'TEST FAILED: concurrent duplicate gifts created % rows', (select count(*) from public.gifts where sender_id = 'c_viewer');
  end if;
end $$;
