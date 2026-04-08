import { createClient } from "@/lib/supabase/server"
import type { RevenueForecast, RevenueForecastInsert } from "@/lib/database.types"

export interface ForecastInput {
  company_level: {
    months: Array<{
      period: string
      revenue: number
      quantity: number
      margin: number
    }>
  }
  product_level: Array<{
    product: string
    months: Array<{
      period: string
      revenue: number
      quantity: number
      margin: number
    }>
  }>
  customer_level: Array<{
    customer: string
    months: Array<{
      period: string
      revenue: number
      quantity: number
      margin: number
    }>
  }>
}

export interface ForecastOutput {
  company_forecast: {
    forecast_month: string
    predicted_revenue: number
    predicted_margin: number
    predicted_quantity: number
    ai_reasoning: string
    ai_suggestions: string
  }
  product_forecasts: Array<{
    product: string
    forecast_month: string
    predicted_revenue: number
    predicted_margin: number
    predicted_quantity: number
    ai_reasoning: string
  }>
  customer_forecasts: Array<{
    customer: string
    forecast_month: string
    predicted_revenue: number
    predicted_margin: number
    predicted_quantity: number
    ai_reasoning: string
  }>
}

/**
 * Call n8n webhook to get AI forecasts from Python service
 */
async function callN8NWebhook(payload: any): Promise<ForecastOutput> {
  const webhookUrl = process.env.N8N_WEBHOOK_FORECAST_URL

  if (!webhookUrl) {
    throw new Error("N8N_WEBHOOK_FORECAST_URL is not configured")
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s timeout for forecasting

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`N8N webhook error: ${response.statusText}`)
    }

    const result = await response.json()
    return result as ForecastOutput
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Forecasting request timed out")
    }
    throw error
  }
}

/**
 * Get next month's date in YYYY-MM-01 format
 */
function getNextMonthDate(): string {
  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`
}

/**
 * Trigger revenue forecasting and store results
 */
export async function triggerRevenueForecast(
  userId: string,
  forecastInput: ForecastInput
): Promise<{
  success: boolean
  forecasts?: RevenueForecast[]
  error?: string
}> {
  try {
    // Call n8n webhook with structured data
    const forecastOutput = await callN8NWebhook({
      action: "forecast_revenue",
      user_id: userId,
      data: forecastInput,
    })

    // Prepare forecast records for insertion
    const supabase = await createClient()
    const forecastMonth = getNextMonthDate()
    const forecasts = []

    // Company-level forecast
    if (forecastOutput.company_forecast) {
      forecasts.push({
        user_id: userId,
        forecast_month: forecastMonth,
        level: "company",
        dimension_value: null,
        predicted_revenue: forecastOutput.company_forecast.predicted_revenue,
        predicted_margin: forecastOutput.company_forecast.predicted_margin,
        predicted_quantity: forecastOutput.company_forecast.predicted_quantity,
        ai_reasoning: forecastOutput.company_forecast.ai_reasoning,
        ai_suggestions: forecastOutput.company_forecast.ai_suggestions,
      })
    }

    // Product-level forecasts
    if (forecastOutput.product_forecasts) {
      for (const pf of forecastOutput.product_forecasts) {
        forecasts.push({
          user_id: userId,
          forecast_month: forecastMonth,
          level: "product",
          dimension_value: pf.product,
          predicted_revenue: pf.predicted_revenue,
          predicted_margin: pf.predicted_margin,
          predicted_quantity: pf.predicted_quantity,
          ai_reasoning: pf.ai_reasoning,
          ai_suggestions: null,
        })
      }
    }

    // Customer-level forecasts
    if (forecastOutput.customer_forecasts) {
      for (const cf of forecastOutput.customer_forecasts) {
        forecasts.push({
          user_id: userId,
          forecast_month: forecastMonth,
          level: "customer",
          dimension_value: cf.customer,
          predicted_revenue: cf.predicted_revenue,
          predicted_margin: cf.predicted_margin,
          predicted_quantity: cf.predicted_quantity,
          ai_reasoning: cf.ai_reasoning,
          ai_suggestions: null,
        })
      }
    }

    // Insert all forecasts
    const { data, error } = await supabase
      .from("revenue_forecasts")
      .insert(forecasts as any)
      .select()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, forecasts: data as RevenueForecast[] }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { success: false, error: message }
  }
}

/**
 * Get the latest company-level forecast
 */
export async function getLatestCompanyForecast(userId: string): Promise<RevenueForecast | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("revenue_forecasts")
    .select("*")
    .eq("user_id", userId)
    .eq("level", "company")
    .order("forecast_month", { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== "PGRST116") {
    // PGRST116 is "no rows returned"
    console.error("Error fetching latest forecast:", error)
  }

  return (data || null) as RevenueForecast | null
}

/**
 * Get all forecasts for a given month and level
 */
export async function getForecastsByMonthAndLevel(
  userId: string,
  forecastMonth: string,
  level: "company" | "product" | "customer"
): Promise<RevenueForecast[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("revenue_forecasts")
    .select("*")
    .eq("user_id", userId)
    .eq("forecast_month", forecastMonth)
    .eq("level", level)
    .order("predicted_revenue", { ascending: false })

  if (error) {
    console.error("Error fetching forecasts:", error)
    return []
  }

  return data || []
}
