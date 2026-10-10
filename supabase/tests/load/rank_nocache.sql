-- The same ranking computed from every gift each time (what get_rankings did before the cache).
select count(*) from private.compute_rankings('gifter', 'week');
