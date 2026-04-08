import { createClient } from "@/lib/supabase/server"
import type { RevenueSimulation, RevenueSimulationInsert, RevenueForecast } from "@/lib/database.types"

export interface SimulationData {
  scenario_name: string
  adjustment_type: "price" | "cost" | "volume" | "mixed"
  adjustment_value: number
}

/**
 * Call n8n webhook to simulate revenue impact from adjustments
 */
async function callN8NSimulationWebhook(payload: any): Promise<{
  projected_revenue: number
  projected_margin: number
  ai_reasoning: string
}> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL

  if (!webhookUrl) {
    throw new Error("N8N_WEBHOOK_URL is not configured")
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s timeout

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

    return await response.json()
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Simulation request timed out")
    }
    throw error
  }
}

/**
 * Run a revenue simulation scenario
 */
export async function runRevenueSimulation(
  userId: string,
  simulationData: SimulationData,
  baseline?: RevenueForecast
): Promise<{
  success: boolean
  simulation?: RevenueSimulation
  error?: string
}> {
  try {
    const supabase = await createClient()

    // Get baseline from latest company forecast if not provided
    let baselineForecast = baseline
    if (!baselineForecast) {
      const { data, error } = await supabase
        .from("revenue_forecasts")
        .select("*")
        .eq("user_id", userId)
        .eq("level", "company")
        .order("forecast_month", { ascending: false })
        .limit(1)
        .single()

      if (error && error.code !== "PGRST116") {
        return {
          success: false,
          error: "Could not fetch baseline forecast for simulation",
        }
      }

      baselineForecast = data as unknown as RevenueForecast | undefined
    }

    if (!baselineForecast) {
      return {
        success: false,
        error: "No baseline forecast found. Please run forecasting first.",
      }
    }

    // Call n8n webhook with simulation parameters
    const simulationResult = await callN8NSimulationWebhook({
      action: "simulate_revenue",
      user_id: userId,
      baseline: {
        revenue: baselineForecast.predicted_revenue,
        margin: baselineForecast.predicted_margin,
        quantity: baselineForecast.predicted_quantity,
      },
      adjustment: simulationData,
    })

    // Store simulation result
    const { data: insertedData, error } = await supabase
      .from("revenue_simulations")
      .insert({
        user_id: userId,
        scenario_name: simulationData.scenario_name,
        adjustment_type: simulationData.adjustment_type,
        adjustment_value: simulationData.adjustment_value,
        projected_revenue: simulationResult.projected_revenue,
        projected_margin: simulationResult.projected_margin,
        ai_reasoning: simulationResult.ai_reasoning,
      } as any)
      .select()
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    return {
      success: true,
      simulation: insertedData as RevenueSimulation,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { success: false, error: message }
  }
}

/**
 * Get all simulations for a user
 */
export async function getUserSimulations(userId: string): Promise<RevenueSimulation[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("revenue_simulations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching simulations:", error)
    return []
  }

  return data || []
}

/**
 * Get a specific simulation by ID
 */
export async function getSimulationById(userId: string, simulationId: string): Promise<RevenueSimulation | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("revenue_simulations")
    .select("*")
    .eq("id", simulationId)
    .eq("user_id", userId)
    .single()

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching simulation:", error)
  }

  return (data || null) as RevenueSimulation | null
}

/**
 * Delete a simulation scenario
 */
export async function deleteSimulation(userId: string, simulationId: string): Promise<{
  success: boolean
  error?: string
}> {
  const supabase = await createClient()

  const { error } = await supabase
    .from("revenue_simulations")
    .delete()
    .eq("id", simulationId)
    .eq("user_id", userId)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}
