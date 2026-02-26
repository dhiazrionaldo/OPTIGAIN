-- GP Optimizer Database Schema
-- Run this on your self-hosted Supabase instance

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  created_at timestamptz default now()
);

-- Gross profit uploads
create table if not exists public.gross_profit_uploads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users on delete cascade,
  file_name text not null,
  uploaded_at timestamptz default now()
);

-- Gross profit rows (parsed Excel data)
create table if not exists public.gross_profit_rows (
  id uuid primary key default uuid_generate_v4(),
  upload_id uuid not null references public.gross_profit_uploads on delete cascade,
  customer_name text not null,
  product_spec text not null,
  quantity numeric not null default 0,
  amount_sales numeric not null default 0,
  freight_cost numeric not null default 0,
  net_sales numeric not null default 0,
  cogs numeric not null default 0,
  gross_margin_value numeric not null default 0,
  gross_margin_percent numeric not null default 0,
  status text,
  sheet_month int,
  sheet_year int
);

-- AI recommendations
create table if not exists public.ai_recommendations (
  id uuid primary key default uuid_generate_v4(),
  upload_id uuid not null references public.gross_profit_uploads on delete cascade,
  customer_name text not null,
  product_spec text not null,
  suggested_amount_sales numeric not null default 0,
  suggested_freight_cost numeric not null default 0,
  suggested_cogs numeric not null default 0,
  predicted_net_sales numeric not null default 0,
  predicted_gm_value numeric not null default 0,
  predicted_gm_percent numeric not null default 0,
  created_at timestamptz default now()
);

-- Ensure new AI columns exist for backward-compatible deployments
alter table public.ai_recommendations
  add column if not exists suggested_quantity numeric;

alter table public.ai_recommendations
  add column if not exists action text;

alter table public.ai_recommendations
  add column if not exists confidence_score numeric;

alter table public.ai_recommendations
  add column if not exists replaced_from text;

alter table public.ai_recommendations
  add column if not exists reason text;

-- Indexes
create index if not exists idx_uploads_user_id on public.gross_profit_uploads(user_id);
create index if not exists idx_rows_upload_id on public.gross_profit_rows(upload_id);
create index if not exists idx_reco_upload_id on public.ai_recommendations(upload_id);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.gross_profit_uploads enable row level security;
alter table public.gross_profit_rows enable row level security;
alter table public.ai_recommendations enable row level security;

-- Profiles policies
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Users can insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- Uploads policies
create policy "Users can view own uploads" on public.gross_profit_uploads
  for select using (auth.uid() = user_id);

create policy "Users can insert own uploads" on public.gross_profit_uploads
  for insert with check (auth.uid() = user_id);

-- Rows policies
create policy "Users can view rows of own uploads" on public.gross_profit_rows
  for select using (
    upload_id in (
      select id from public.gross_profit_uploads where user_id = auth.uid()
    )
  );

create policy "Users can insert rows for own uploads" on public.gross_profit_rows
  for insert with check (
    upload_id in (
      select id from public.gross_profit_uploads where user_id = auth.uid()
    )
  );

-- AI recommendations policies
create policy "Users can view reco of own uploads" on public.ai_recommendations
  for select using (
    upload_id in (
      select id from public.gross_profit_uploads where user_id = auth.uid()
    )
  );

-- add sheet month/year columns to rows if they don't already exist (migration)
alter table public.gross_profit_rows
  add column if not exists sheet_month int;

alter table public.gross_profit_rows
  add column if not exists sheet_year int;

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for new user
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
