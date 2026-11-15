-- Enable PostGIS in extensions schema
create extension if not exists postgis with schema extensions;

create table if not exists public.regions (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  state text not null,
  level text not null check (level in ('district', 'constituency', 'ward')),
  population bigint not null,
  density integer not null,
  literacy_rate numeric(5,2) not null,
  aqi_pm25 integer,
  hospitals_count integer not null default 0,
  sex_ratio integer not null default 875,
  green_cover_pct numeric(5,2) not null default 18.5,
  schools_count integer not null default 120,
  avg_circle_rate integer not null default 8500,
  geojson jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.insights (
  id bigint generated always as identity primary key,
  region_code text not null references public.regions(code),
  title text not null,
  summary text not null,
  author text not null default 'Civic Researcher',
  metric text not null default 'literacy_rate',
  views_count integer not null default 120,
  downloads_count integer not null default 14,
  created_at timestamptz not null default now()
);

create index if not exists idx_insights_region_code on public.insights (region_code);

alter table public.regions enable row level security;
alter table public.insights enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.regions to anon, authenticated;
grant select, insert on public.insights to anon, authenticated;
grant update (views_count, downloads_count) on public.insights to anon, authenticated;
grant usage, select on sequence public.insights_id_seq to anon, authenticated;

create policy "Public can read regions"
  on public.regions
  for select
  to anon, authenticated
  using (true);

create policy "Public can read insights"
  on public.insights
  for select
  to anon, authenticated
  using (true);

create policy "Public can insert insights"
  on public.insights
  for insert
  to anon, authenticated
  with check (char_length(title) between 3 and 200 and char_length(summary) between 5 and 2000);
