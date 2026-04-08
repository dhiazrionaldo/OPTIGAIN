import { createClient } from "@/lib/supabase/server"
import type { SalesPerformance, SalesPerformanceInsert } from "@/lib/database.types"

export interface SalesPerformanceRow {
  customer_name: string
  product_variant: string // maps from product_spec
  quantity: number
  net_sales: number
  freight_cost: number
  cogs: number
  gross_margin_value: number
  gross_margin_percent: number
}

/**
 * Convert period_month and year to ISO date string (YYYY-MM-01)
 */
function createPeriodMonth(month: number | undefined, year: number | undefined): string {
  if (!month || !year) {
    // fallback to current month if not specified
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  }
  return `${year}-${String(month).padStart(2, "0")}-01`
}

/**
 * Insert parsed sales data into sales_performance table
 * Maps product_spec to product_variant for consistency with new schema
 */
export async function insertSalesPerformanceData(
  rows: Array<{
    customer_name: string
    product_spec: string
    quantity: number
    net_sales: number
    freight_cost: number
    cogs: number
    gross_margin_value: number
    gross_margin_percent: number
    sheet_month?: number
    sheet_year?: number
  }>,
  userId: string
): Promise<{
  insertedCount: number
  errors: string[]
}> {
  if (!userId) {
    return { insertedCount: 0, errors: ["User ID is required"] }
  }

  if (rows.length === 0) {
    return { insertedCount: 0, errors: [] }
  }

  const supabase = await createClient()
  const errors: string[] = []
  let insertedCount = 0

  // Group rows by period_month to maintain consistency within a batch
  const rowsByMonth = new Map<string, typeof rows>()

  for (const row of rows) {
    const periodMonth = createPeriodMonth(row.sheet_month, row.sheet_year)
    if (!rowsByMonth.has(periodMonth)) {
      rowsByMonth.set(periodMonth, [])
    }
    rowsByMonth.get(periodMonth)!.push(row)
  }

  // Insert rows batch by batch
  for (const [periodMonth, monthRows] of rowsByMonth) {
    const data = monthRows.map((row) => ({
      user_id: userId,
      period_month: periodMonth,
      customer_name: row.customer_name.trim(),
      product_variant: row.product_spec.trim(),
      quantity: row.quantity,
      net_sales: row.net_sales,
      freight_cost: row.freight_cost,
      cogs: row.cogs,
      gross_margin_value: row.gross_margin_value,
      gross_margin_percent: row.gross_margin_percent,
    }))

    const { error } = await supabase.from("sales_performance").insert(data as any)

    if (error) {
      errors.push(`Failed to insert ${monthRows.length} rows for ${periodMonth}: ${error.message}`)
    } else {
      insertedCount += monthRows.length
    }
  }

  return { insertedCount, errors }
}

/**
 * Get latest revenue data for a user (last 12-24 months)
 */
export async function getRecentSalesPerformance(
  userId: string,
  months: number = 24
): Promise<SalesPerformance[]> {
  const supabase = await createClient()

  // Calculate date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - months)

  const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01`
  const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`

  const { data, error } = await supabase
    .from("sales_performance")
    .select("*")
    .eq("user_id", userId)
    .gte("period_month", startDateStr)
    .lte("period_month", endDateStr)
    .order("period_month", { ascending: false })

  if (error) {
    console.error("Error fetching recent sales performance:", error)
    return []
  }

  return data || []
}

/**
 * Aggregate sales performance data by time period and dimension
 */
export function aggregateSalesData(data: SalesPerformance[]) {
  // By month (company level)
  const monthlyAggregates = new Map<string, {
    period_month: string
    total_revenue: number
    total_quantity: number
    total_margin: number
    margin_percent: number
  }>()

  // By product
  const productAggregates = new Map<string, {
    product_variant: string
    periods: Map<string, {
      revenue: number
      quantity: number
      margin: number
    }>
  }>()

  // By customer
  const customerAggregates = new Map<string, {
    customer_name: string
    periods: Map<string, {
      revenue: number
      quantity: number
      margin: number
    }>
  }>()

  for (const row of data) {
    // Monthly aggregate
    if (!monthlyAggregates.has(row.period_month)) {
      monthlyAggregates.set(row.period_month, {
        period_month: row.period_month,
        total_revenue: 0,
        total_quantity: 0,
        total_margin: 0,
        margin_percent: 0,
      })
    }
    const monthly = monthlyAggregates.get(row.period_month)!
    monthly.total_revenue += row.net_sales
    monthly.total_quantity += row.quantity
    monthly.total_margin += row.gross_margin_value

    // Product aggregate
    if (!productAggregates.has(row.product_variant)) {
      productAggregates.set(row.product_variant, {
        product_variant: row.product_variant,
        periods: new Map(),
      })
    }
    const product = productAggregates.get(row.product_variant)!
    if (!product.periods.has(row.period_month)) {
      product.periods.set(row.period_month, { revenue: 0, quantity: 0, margin: 0 })
    }
    const productPeriod = product.periods.get(row.period_month)!
    productPeriod.revenue += row.net_sales
    productPeriod.quantity += row.quantity
    productPeriod.margin += row.gross_margin_value

    // Customer aggregate
    if (!customerAggregates.has(row.customer_name)) {
      customerAggregates.set(row.customer_name, {
        customer_name: row.customer_name,
        periods: new Map(),
      })
    }
    const customer = customerAggregates.get(row.customer_name)!
    if (!customer.periods.has(row.period_month)) {
      customer.periods.set(row.period_month, { revenue: 0, quantity: 0, margin: 0 })
    }
    const customerPeriod = customer.periods.get(row.period_month)!
    customerPeriod.revenue += row.net_sales
    customerPeriod.quantity += row.quantity
    customerPeriod.margin += row.gross_margin_value
  }

  // Calculate margin percentages for monthly data
  for (const monthly of monthlyAggregates.values()) {
    monthly.margin_percent = monthly.total_revenue > 0 
      ? (monthly.total_margin / monthly.total_revenue) * 100 
      : 0
  }

  return {
    monthly: Array.from(monthlyAggregates.values()),
    products: Array.from(productAggregates.values()),
    customers: Array.from(customerAggregates.values()),
  }
}
