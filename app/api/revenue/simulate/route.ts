import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { runRevenueSimulation, getUserSimulations, deleteSimulation } from "@/lib/revenue-simulation"
import type { SimulationData } from "@/lib/revenue-simulation"

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

    const body = await req.json()
    const { scenario_name, adjustment_type, adjustment_value } = body as SimulationData

    // Validate input
    if (!scenario_name || !adjustment_type || adjustment_value === undefined) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: scenario_name, adjustment_type, adjustment_value",
        },
        { status: 400 }
      )
    }

    const validAdjustmentTypes = ["price", "cost", "volume", "mixed"]
    if (!validAdjustmentTypes.includes(adjustment_type)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid adjustment_type. Must be one of: ${validAdjustmentTypes.join(", ")}`,
        },
        { status: 400 }
      )
    }

    // Run simulation
    const result = await runRevenueSimulation(user.id, {
      scenario_name,
      adjustment_type: adjustment_type as "price" | "cost" | "volume" | "mixed",
      adjustment_value: Number(adjustment_value),
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: "Simulation completed successfully",
        simulation: result.simulation,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error("simulate API error:", err)
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

    // Get user's simulations
    const simulations = await getUserSimulations(user.id)

    return NextResponse.json(
      {
        success: true,
        simulations,
      },
      { status: 200 }
    )
  } catch (err) {
    console.error("simulate GET API error:", err)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
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

    // Get simulation ID from query params
    const simulationId = req.nextUrl.searchParams.get("id")

    if (!simulationId) {
      return NextResponse.json(
        { success: false, error: "Missing simulation ID" },
        { status: 400 }
      )
    }

    // Delete simulation
    const result = await deleteSimulation(user.id, simulationId)

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: true, message: "Simulation deleted successfully" },
      { status: 200 }
    )
  } catch (err) {
    console.error("simulate DELETE API error:", err)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}
