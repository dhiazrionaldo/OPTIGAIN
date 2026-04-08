-- Revenue Intelligence System Tables
-- Run this migration after the main schema

-- sales_performance: Time-series revenue data table
create table if not exists public.sales_performance (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null,
  customer_name text not null,
  product_variant text not null,
  quantity numeric not null default 0,
  net_sales numeric not null default 0,
  freight_cost numeric not null default 0,
  cogs numeric not null default 0,
  gross_margin_value numeric not null default 0,
  gross_margin_percent numeric not null default 0,
  created_at timestamptz default now()
);

-- Indexes on sales_performance for query performance
create index if not exists idx_sales_performance_user_id on public.sales_performance(user_id);
create index if not exists idx_sales_performance_period_month on public.sales_performance(period_month);
create index if not exists idx_sales_performance_customer_name on public.sales_performance(customer_name);
create index if not exists idx_sales_performance_product_variant on public.sales_performance(product_variant);
create index if not exists idx_sales_performance_user_period on public.sales_performance(user_id, period_month);

-- Enable Row Level Security for sales_performance
alter table public.sales_performance enable row level security;

-- RLS Policy: Users can only read their own data
create policy "sales_performance_select_own"
  on public.sales_performance for select
  using (auth.uid() = user_id);

-- RLS Policy: Users can only insert their own data
create policy "sales_performance_insert_own"
  on public.sales_performance for insert
  with check (auth.uid() = user_id);

-- RLS Policy: Users can only update their own data
create policy "sales_performance_update_own"
  on public.sales_performance for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RLS Policy: Users can only delete their own data
create policy "sales_performance_delete_own"
  on public.sales_performance for delete
  using (auth.uid() = user_id);

-----------------------------------------------
-- revenue_forecasts: AI forecast results table
create table if not exists public.revenue_forecasts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  forecast_month date not null,
  level text not null check (level in ('company', 'product', 'customer')),
  dimension_value text,
  predicted_revenue numeric not null default 0,
  predicted_margin numeric not null default 0,
  predicted_quantity numeric not null default 0,
  ai_reasoning text,
  ai_suggestions text,
  created_at timestamptz default now()
);

-- Indexes on revenue_forecasts
create index if not exists idx_revenue_forecasts_user_id on public.revenue_forecasts(user_id);
create index if not exists idx_revenue_forecasts_forecast_month on public.revenue_forecasts(forecast_month);
create index if not exists idx_revenue_forecasts_level on public.revenue_forecasts(level);
create index if not exists idx_revenue_forecasts_user_month on public.revenue_forecasts(user_id, forecast_month);

-- Enable Row Level Security for revenue_forecasts
alter table public.revenue_forecasts enable row level security;

-- RLS Policy: Users can only read their own forecasts
create policy "revenue_forecasts_select_own"
  on public.revenue_forecasts for select
  using (auth.uid() = user_id);

-- RLS Policy: Users can only insert their own forecasts
create policy "revenue_forecasts_insert_own"
  on public.revenue_forecasts for insert
  with check (auth.uid() = user_id);

-- RLS Policy: Users can only update their own forecasts
create policy "revenue_forecasts_update_own"
  on public.revenue_forecasts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RLS Policy: Users can only delete their own forecasts
create policy "revenue_forecasts_delete_own"
  on public.revenue_forecasts for delete
  using (auth.uid() = user_id);

-----------------------------------------------
-- revenue_simulations: Scenario simulation results
create table if not exists public.revenue_simulations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scenario_name text not null,
  adjustment_type text not null check (adjustment_type in ('price', 'cost', 'volume', 'mixed')),
  adjustment_value numeric not null,
  projected_revenue numeric not null default 0,
  projected_margin numeric not null default 0,
  ai_reasoning text,
  created_at timestamptz default now()
);

-- Indexes on revenue_simulations
create index if not exists idx_revenue_simulations_user_id on public.revenue_simulations(user_id);
create index if not exists idx_revenue_simulations_created_at on public.revenue_simulations(created_at);
create index if not exists idx_revenue_simulations_user_created on public.revenue_simulations(user_id, created_at desc);

-- Enable Row Level Security for revenue_simulations
alter table public.revenue_simulations enable row level security;

-- RLS Policy: Users can only read their own simulations
create policy "revenue_simulations_select_own"
  on public.revenue_simulations for select
  using (auth.uid() = user_id);

-- RLS Policy: Users can only insert their own simulations
create policy "revenue_simulations_insert_own"
  on public.revenue_simulations for insert
  with check (auth.uid() = user_id);

-- RLS Policy: Users can only update their own simulations
create policy "revenue_simulations_update_own"
  on public.revenue_simulations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RLS Policy: Users can only delete their own simulations
create policy "revenue_simulations_delete_own"
  on public.revenue_simulations for delete
  using (auth.uid() = user_id);
