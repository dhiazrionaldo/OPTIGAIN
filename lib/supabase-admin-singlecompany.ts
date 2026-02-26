import { createServiceClient } from "./supabase/server"

/**
 * Single-company database operations for production and simulation modules.
 * Uses service role for all operations (single company context).
 */

export async function getAdminClient() {
  const client = await createServiceClient()
  return client
}

// ============================================
// SKU Operations
// ============================================

export async function createSKU(
  sku_code: string,
  product_name: string,
  category: string,
  base_price: number,
  base_cost: number
): Promise<{ id: string }> {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("sku_master")
    .insert({
      sku_code,
      product_name,
      category,
      base_price,
      base_cost,
    })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Failed to create SKU: ${error.message}`)
  }

  return { id: data.id }
}

export async function getSKU(sku_id: string) {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("sku_master")
    .select("*")
    .eq("id", sku_id)
    .single()

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch SKU: ${error.message}`)
  }

  return data || null
}

export async function getAllSKUs() {
  const client = await getAdminClient()

  const { data, error } = await client.from("sku_master").select("*").order("sku_code")

  if (error) {
    throw new Error(`Failed to fetch SKUs: ${error.message}`)
  }

  return data || []
}

// ============================================
// Production Row Operations
// ============================================

export async function createProductionRow(
  sku_id: string,
  production_date: string,
  quantity: number,
  production_cost: number
): Promise<{ id: string }> {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("production_rows")
    .insert({
      sku_id,
      production_date,
      quantity,
      production_cost,
    })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Failed to create production row: ${error.message}`)
  }

  return { id: data.id }
}

export async function getProductionHistory(sku_id: string, months: number = 6) {
  const client = await getAdminClient()

  // Get last N months of production data
  const dateThreshold = new Date()
  dateThreshold.setMonth(dateThreshold.getMonth() - months)

  const { data, error } = await client
    .from("production_rows")
    .select("*, sku_master:sku_id(sku_code, product_name)")
    .eq("sku_id", sku_id)
    .gte("production_date", dateThreshold.toISOString().split("T")[0])
    .order("production_date", { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch production history: ${error.message}`)
  }

  return data || []
}

export async function getProductionHistoryAggregated(sku_id: string, months: number = 6) {
  const client = await getAdminClient()

  const dateThreshold = new Date()
  dateThreshold.setMonth(dateThreshold.getMonth() - months)

  const { data, error } = await client
    .from("production_rows")
    .select("production_date, quantity, production_cost")
    .eq("sku_id", sku_id)
    .gte("production_date", dateThreshold.toISOString().split("T")[0])
    .order("production_date", { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch production history: ${error.message}`)
  }

  // Aggregate by month
  const aggregated: Record<string, { quantity: number; cost: number }> = {}

  ;(data || []).forEach((row: any) => {
    const yearMonth = row.production_date.substring(0, 7) // "2025-01"
    if (!aggregated[yearMonth]) {
      aggregated[yearMonth] = { quantity: 0, cost: 0 }
    }
    aggregated[yearMonth].quantity += row.quantity
    aggregated[yearMonth].cost += row.production_cost || 0
  })

  return Object.entries(aggregated).map(([month, data]) => ({
    month,
    quantity: data.quantity,
    cost: data.cost,
  }))
}

// ============================================
// Production Forecast Operations
// ============================================

export async function createProductionForecast(
  sku_id: string,
  forecast_month: string,
  predicted_quantity: number,
  confidence: number
): Promise<{ id: string }> {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("production_forecasts")
    .insert({
      sku_id,
      forecast_month,
      predicted_quantity,
      confidence,
    })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Failed to create forecast: ${error.message}`)
  }

  return { id: data.id }
}

export async function getLatestForecast(sku_id: string) {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("production_forecasts")
    .select("*")
    .eq("sku_id", sku_id)
    .order("forecast_month", { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch forecast: ${error.message}`)
  }

  return data || null
}

export async function getAllForecasts(sku_id: string) {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("production_forecasts")
    .select("*")
    .eq("sku_id", sku_id)
    .order("forecast_month", { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch forecasts: ${error.message}`)
  }

  return data || []
}

// ============================================
// Revenue Simulation Operations
// ============================================

export async function createRevenueSimulation(
  sku_id: string,
  scenario_name: string,
  simulated_price: number,
  simulated_cost: number,
  projected_quantity: number,
  projected_revenue: number,
  projected_profit: number
): Promise<{ id: string }> {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("revenue_simulations")
    .insert({
      sku_id,
      scenario_name,
      simulated_price,
      simulated_cost,
      projected_quantity,
      projected_revenue,
      projected_profit,
    })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Failed to create simulation: ${error.message}`)
  }

  return { id: data.id }
}

export async function getSimulationsBySkU(sku_id: string) {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("revenue_simulations")
    .select("*")
    .eq("sku_id", sku_id)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch simulations: ${error.message}`)
  }

  return data || []
}

export async function getAllSimulations() {
  const client = await getAdminClient()

  const { data, error } = await client
    .from("revenue_simulations")
    .select("*, sku_master:sku_id(sku_code, product_name)")
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch simulations: ${error.message}`)
  }

  return data || []
}

// ============================================
// Analytics Operations
// ============================================

export async function getMonthlyProductionStats(year: number, month: number) {
  const client = await getAdminClient()

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`
  const endDate = new Date(year, month, 0).toISOString().split("T")[0]

  const { data, error } = await client
    .from("production_rows")
    .select("sku_id, sku_master:sku_id(sku_code, product_name), quantity, production_cost")
    .gte("production_date", startDate)
    .lte("production_date", endDate)

  if (error) {
    throw new Error(`Failed to fetch monthly stats: ${error.message}`)
  }

  return data || []
}

export async function getTopSKUsByRevenue(limit: number = 5) {
  const client = await getAdminClient()

  // Get last month's production
  const lastMonth = new Date()
  lastMonth.setMonth(lastMonth.getMonth() - 1)
  const startDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`

  const { data, error } = await client
    .from("production_rows")
    .select("sku_id, sku_master:sku_id(base_price), quantity")
    .gte("production_date", startDate)

  if (error) {
    throw new Error(`Failed to fetch top SKUs: ${error.message}`)
  }

  // Aggregate revenue by SKU
  const skuRevenue: Record<string, number> = {}
  data?.forEach((row: any) => {
    const skuId = row.sku_id
    const revenue = row.quantity * (row.sku_master?.base_price || 0)
    skuRevenue[skuId] = (skuRevenue[skuId] || 0) + revenue
  })

  // Sort and limit
  return Object.entries(skuRevenue)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([skuId, revenue]) => ({ skuId, revenue }))
}
