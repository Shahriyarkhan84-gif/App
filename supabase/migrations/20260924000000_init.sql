-- Streamly schema. Auth is handled by Clerk via Supabase third-party auth:
-- the Clerk user id arrives as the JWT `sub` claim, read with requesting_user_id().

create or replace function public.requesting_user_id()
returns text
language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::text $$;

-- Profiles are written by the clerk-webhook edge function (service role).
create table public.profiles (
  id text primary key,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

-- Catalog. Metadata is public; stream URLs live in video_streams (gated).
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  genres text[] not null default '{}',
  release_year int,
  duration_seconds int,
  maturity_rating text,
  poster_url text not null,
  backdrop_url text not null,
  is_premium boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.video_streams (
  video_id uuid primary key references public.videos(id) on delete cascade,
  hls_url text not null
);

-- Stripe subscription state, written only by the stripe-webhook function.
create table public.subscriptions (
  user_id text primary key,
  stripe_customer_id text unique not null,
  stripe_subscription_id text unique,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.watchlist (
  user_id text not null default public.requesting_user_id(),
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table public.watch_progress (
  user_id text not null default public.requesting_user_id(),
  video_id uuid not null references public.videos(id) on delete cascade,
  position_seconds int not null default 0 check (position_seconds >= 0),
  duration_seconds int not null default 0 check (duration_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index watch_progress_recent_idx on public.watch_progress (user_id, updated_at desc);
create index watchlist_recent_idx on public.watchlist (user_id, created_at desc);

create or replace function public.has_active_subscription()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = public.requesting_user_id()
      and status in ('active', 'trialing')
  )
$$;

-- Row Level Security ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.video_streams enable row level security;
alter table public.subscriptions enable row level security;
alter table public.watchlist enable row level security;
alter table public.watch_progress enable row level security;

create policy "Users read own profile" on public.profiles
  for select to authenticated using (id = public.requesting_user_id());

create policy "Catalog is readable" on public.videos
  for select to anon, authenticated using (true);

create policy "Free streams for members, premium for subscribers" on public.video_streams
  for select to authenticated using (
    exists (
      select 1 from public.videos v
      where v.id = video_id and (not v.is_premium or public.has_active_subscription())
    )
  );

create policy "Users read own subscription" on public.subscriptions
  for select to authenticated using (user_id = public.requesting_user_id());

create policy "Users manage own watchlist" on public.watchlist
  for all to authenticated
  using (user_id = public.requesting_user_id())
  with check (user_id = public.requesting_user_id());

create policy "Users manage own progress" on public.watch_progress
  for all to authenticated
  using (user_id = public.requesting_user_id())
  with check (user_id = public.requesting_user_id());
