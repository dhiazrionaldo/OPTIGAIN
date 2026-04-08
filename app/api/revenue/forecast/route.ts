import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRecentSalesPerformance, aggregateSalesData } from "@/lib/sales-performance"
import { triggerRevenueForecast, type ForecastInput } from "@/lib/revenue-forecast"

export async function POST(req: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Get recent sales performance data (24 months)
    const salesData = await getRecentSalesPerformance(user.id, 24)

    if (salesData.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No sales data found. Please upload Excel data first.",
        },
        { status: 400 }
      )
    }

    // Aggregate data by time period and dimension
    const aggregated = aggregateSalesData(salesData)

    // Prepare forecast input in the format expected by Python service
    const forecastInput: ForecastInput = {
      company_level: {
        months: aggregated.monthly.map((m) => ({
          period: m.period_month,
          revenue: m.total_revenue,
          quantity: m.total_quantity,
          margin: m.total_margin,
        })),
      },
      product_level: aggregated.products.map((p) => ({
        product: p.product_variant,
        months: Array.from(p.periods.entries()).map(([period, data]) => ({
          period,
          revenue: data.revenue,
          quantity: data.quantity,
          margin: data.margin,
        })),
      })),
      customer_level: aggregated.customers.map((c) => ({
        customer: c.customer_name,
        months: Array.from(c.periods.entries()).map(([period, data]) => ({
          period,
          revenue: data.revenue,
          quantity: data.quantity,
          margin: data.margin,
        })),
      })),
    }

    // Trigger AI forecasting
    const result = await triggerRevenueForecast(user.id, forecastInput)

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: "Forecast completed successfully",
        forecastCount: result.forecasts?.length || 0,
        forecasts: result.forecasts,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error("forecast API error:", err)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Get latest forecasts
    const { data, error } = await supabase
      .from("revenue_forecasts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        forecasts: data,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error("forecast GET API error:", err)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}
