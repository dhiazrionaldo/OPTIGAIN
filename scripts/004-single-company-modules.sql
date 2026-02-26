-- Migration: 004-single-company-modules.sql
-- Single-company architecture for production, forecast, and simulation modules
-- Drop previous multi-tenant tables if they exist
drop table if exists public.revenue_simulations cascade;
drop table if exists public.production_forecasts cascade;
drop table if exists public.production_data cascade;
drop table if exists public.ai_recommendations cascade;
drop table if exists public.gross_profits cascade;
drop table if exists public.sku_master cascade;

-- sku_master: centralized SKU registry (single company)
create table if not exists public.sku_master (
  id uuid primary key default gen_random_uuid(),
  sku_code text unique not null,
  product_name text not null,
  category text not null,
  base_price numeric,
  base_cost numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- production_rows: raw production events
create table if not exists public.production_rows (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.sku_master(id) on delete restrict,
  production_date date not null,
  quantity integer not null,
  production_cost numeric,
  created_at timestamptz default now()
);

-- production_forecasts: AI-generated forecasts per SKU
create table if not exists public.production_forecasts (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.sku_master(id) on delete restrict,
  forecast_month date not null,
  predicted_quantity integer,
  confidence numeric,
  created_at timestamptz default now()
);

-- revenue_simulations: scenario-based projections
create table if not exists public.revenue_simulations (
  id uuid primary key default gen_random_uuid(),
  scenario_name text,
  sku_id uuid not null references public.sku_master(id) on delete restrict,
  simulated_price numeric,
  simulated_cost numeric,
  projected_quantity integer,
  projected_revenue numeric,
  projected_profit numeric,
  created_at timestamptz default now()
);

-- indexes for query performance
create index if not exists idx_production_rows_date on public.production_rows(production_date);
create index if not exists idx_production_rows_sku on public.production_rows(sku_id);
create index if not exists idx_production_forecasts_sku on public.production_forecasts(sku_id);
create index if not exists idx_production_forecasts_month on public.production_forecasts(forecast_month);
create index if not exists idx_revenue_simulations_sku on public.revenue_simulations(sku_id);
create index if not exists idx_sku_master_code on public.sku_master(sku_code);
