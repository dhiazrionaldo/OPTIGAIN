import { NextRequest, NextResponse } from "next/server"
import { GenerateForecastSchema } from "@/lib/validators-singlecompany"
import {
  getProductionHistoryAggregated,
  getSKU,
  createProductionForecast,
} from "@/lib/supabase-admin-singlecompany"

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL

/**
 * POST /api/production/forecast
 *
 * Flow:
 * 1. Validate sku_id
 * 2. Fetch last 6 months production data aggregated by month
 * 3. Send historical data to AI webhook
 * 4. Receive predicted_quantity and confidence
 * 5. Insert into production_forecasts
 * 6. Return forecast result
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = GenerateForecastSchema.parse(body)

    // Fetch SKU details
    const sku = await getSKU(validated.sku_id)
    if (!sku) {
      return NextResponse.json({ success: false, error: "SKU not found" }, { status: 404 })
    }

    // Fetch production history (last 6 months, aggregated)
    const productionHistory = await getProductionHistoryAggregated(validated.sku_id, 6)

    // Prepare payload for AI webhook
    const webhookPayload = {
      sku_id: validated.sku_id,
      sku_code: sku.sku_code,
      historical: productionHistory.map((p) => ({
        month: p.month,
        quantity: p.quantity,
        cost: p.cost,
      })),
    }

    // Call AI webhook
    if (!N8N_WEBHOOK_URL) {
      console.error("N8N_WEBHOOK_URL not configured")
      return NextResponse.json(
        { success: false, error: "AI service not configured" },
        { status: 500 }
      )
    }

    const aiResponse = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "forecast",
        ...webhookPayload,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!aiResponse.ok) {
      throw new Error(`AI service error: ${aiResponse.statusText}`)
    }

    const aiResult = await aiResponse.json()

    // Validate AI response
    if (!aiResult.predicted_quantity || aiResult.confidence === undefined) {
      throw new Error("Invalid AI response: missing predicted_quantity or confidence")
    }

    // Calculate forecast month (next month)
    const now = new Date()
    const forecastMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const forecastMonthStr = forecastMonth.toISOString().split("T")[0]

    // Insert forecast into database
    const forecast = await createProductionForecast(
      validated.sku_id,
      forecastMonthStr,
      aiResult.predicted_quantity,
      aiResult.confidence
    )

    return NextResponse.json({
      success: true,
      forecast_id: forecast.id,
      predicted_quantity: aiResult.predicted_quantity,
      confidence: aiResult.confidence,
      forecast_month: forecastMonthStr,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error(`[Production Forecast] Error: ${message}`)
    return NextResponse.json(
      { success: false, error: message },
      { status: error instanceof Error && error.message.includes("validation") ? 400 : 500 }
    )
  }
}
