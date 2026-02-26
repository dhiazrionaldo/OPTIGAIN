import { NextRequest, NextResponse } from "next/server"
import { CreateRevenueSimulationSchema } from "@/lib/validators-singlecompany"
import {
  getSKU,
  getLatestForecast,
  createRevenueSimulation,
} from "@/lib/supabase-admin-singlecompany"

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL

/**
 * POST /api/revenue/simulate
 *
 * Flow:
 * 1. Validate input (sku_id, new_price, new_cost, scenario_name)
 * 2. Fetch latest forecast and SKU master data
 * 3. Send to AI webhook with both base and new prices/costs
 * 4. Receive projected_quantity, projected_revenue, projected_profit
 * 5. Insert into revenue_simulations
 * 6. Return simulation result
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = CreateRevenueSimulationSchema.parse(body)

    // Fetch SKU details
    const sku = await getSKU(validated.sku_id)
    if (!sku) {
      return NextResponse.json({ success: false, error: "SKU not found" }, { status: 404 })
    }

    // Fetch latest forecast
    const forecast = await getLatestForecast(validated.sku_id)
    if (!forecast) {
      return NextResponse.json(
        { success: false, error: "No forecast available for this SKU. Generate a forecast first." },
        { status: 400 }
      )
    }

    // Prepare payload for AI webhook
    const webhookPayload = {
      sku_id: validated.sku_id,
      sku_code: sku.sku_code,
      base_price: sku.base_price,
      base_cost: sku.base_cost,
      new_price: validated.new_price,
      new_cost: validated.new_cost,
      predicted_quantity: forecast.predicted_quantity,
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
        mode: "simulation",
        ...webhookPayload,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!aiResponse.ok) {
      throw new Error(`AI service error: ${aiResponse.statusText}`)
    }

    const aiResult = await aiResponse.json()

    // Validate AI response
    if (
      aiResult.projected_quantity === undefined ||
      aiResult.projected_revenue === undefined ||
      aiResult.projected_profit === undefined
    ) {
      throw new Error("Invalid AI response: missing simulation results")
    }

    // Insert simulation into database
    const simulation = await createRevenueSimulation(
      validated.sku_id,
      validated.scenario_name,
      validated.new_price,
      validated.new_cost,
      aiResult.projected_quantity,
      aiResult.projected_revenue,
      aiResult.projected_profit
    )

    // Calculate deltas
    const baseRevenue = forecast.predicted_quantity * sku.base_price
    const baseProfit = forecast.predicted_quantity * (sku.base_price - sku.base_cost)

    return NextResponse.json({
      success: true,
      simulation_id: simulation.id,
      projected_quantity: aiResult.projected_quantity,
      projected_revenue: aiResult.projected_revenue,
      projected_profit: aiResult.projected_profit,
      delta_revenue: aiResult.projected_revenue - baseRevenue,
      delta_profit: aiResult.projected_profit - baseProfit,
      delta_revenue_percent:
        baseRevenue > 0 ? ((aiResult.projected_revenue - baseRevenue) / baseRevenue) * 100 : 0,
      delta_profit_percent:
        baseProfit > 0 ? ((aiResult.projected_profit - baseProfit) / baseProfit) * 100 : 0,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error(`[Revenue Simulation] Error: ${message}`)
    return NextResponse.json(
      { success: false, error: message },
      { status: error instanceof Error && error.message.includes("validation") ? 400 : 500 }
    )
  }
}
