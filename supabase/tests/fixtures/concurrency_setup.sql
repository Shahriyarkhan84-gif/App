insert into public.profiles (id, username) values ('c_viewer', 'c_viewer'), ('c_host', 'c_host');
insert into public.hosts (user_id) values ('c_host');
insert into public.rooms (host_id, status) values ('c_host', 'live');
insert into public.wallets (user_id, coin_balance) values ('c_viewer', 100);
