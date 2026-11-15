-- High-Detail GIS Boundary Features & Persistent Community Data Catalog
alter table public.regions
  add column if not exists population_density integer,
  add column if not exists sex_ratio integer default 868,
  add column if not exists green_cover_pct numeric(5,2) default 18.5,
  add column if not exists schools_count integer default 120,
  add column if not exists avg_circle_rate integer default 12000,
  add column if not exists area_sq_km numeric(10,2) default 100,
  add column if not exists parent_region text,
  add column if not exists rep_name text,
  add column if not exists rep_role text,
  add column if not exists rep_party text,
  add column if not exists rep_term text,
  add column if not exists rep_votes integer,
  add column if not exists rep_source_label text,
  add column if not exists rep_source_url text,
  add column if not exists rep_affidavit_url text,
  add column if not exists boundary_source_label text,
  add column if not exists boundary_source_url text,
  add column if not exists data_source_label text,
  add column if not exists data_source_url text,
  add column if not exists center jsonb;

alter table public.insights
  add column if not exists slug text,
  add column if not exists boundary_level text default 'district',
  add column if not exists metric text default 'population_density',
  add column if not exists center_lng numeric(9,5) default 77.21,
  add column if not exists center_lat numeric(9,5) default 28.56,
  add column if not exists zoom numeric(4,2) default 9.5,
  add column if not exists layers_json jsonb default '[]'::jsonb,
  add column if not exists views_count integer default 142,
  add column if not exists downloads_count integer default 18;

create table if not exists public.boundary_features (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  state text not null,
  parent_region text,
  level text not null check (level in ('district', 'constituency', 'assembly', 'ward')),
  area_sq_km numeric(10,2) default 0,
  population bigint not null default 0,
  population_density integer not null default 0,
  literacy_rate numeric(5,2) not null default 0,
  sex_ratio integer not null default 865,
  green_cover_pct numeric(5,2) not null default 15,
  hospitals_count integer not null default 0,
  schools_count integer not null default 0,
  avg_circle_rate integer not null default 0,
  aqi_pm25 integer,
  rep_name text,
  rep_role text,
  rep_party text,
  rep_term text,
  rep_votes integer,
  rep_source_label text,
  rep_source_url text,
  rep_affidavit_url text,
  boundary_source_label text,
  boundary_source_url text,
  data_source_label text,
  data_source_url text,
  center jsonb,
  properties jsonb,
  geojson jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_boundary_features_level on public.boundary_features (level);

alter table public.boundary_features enable row level security;
grant select, insert, update on public.boundary_features to anon, authenticated;
grant usage, select on sequence public.boundary_features_id_seq to anon, authenticated;

create table if not exists public.community_layers (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  layer_type text not null check (layer_type in ('point', 'choropleth')),
  boundary_level text check (boundary_level in ('district', 'constituency', 'assembly', 'ward')),
  category text not null default 'Civic Infrastructure',
  metric_label text not null default 'Value',
  unit text not null default '',
  publisher text not null default 'Community Contributor',
  source_url text not null default 'https://data.gov.in',
  license text not null default 'GODL-India',
  color text not null default '#10b981',
  feature_count integer not null default 0,
  available_dates jsonb not null default '[]'::jsonb,
  choropleth_by_date jsonb not null default '{}'::jsonb,
  points_by_date jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.community_layers enable row level security;
grant select, insert on public.community_layers to anon, authenticated;
grant usage, select on sequence public.community_layers_id_seq to anon, authenticated;
