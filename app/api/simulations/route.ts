import { NextResponse } from "next/server"
import { getAllSimulations } from "@/lib/supabase-admin-singlecompany"

/**
 * GET /api/simulations
 * Returns all simulations in the system
 */
export async function GET() {
  try {
    const simulations = await getAllSimulations()
    return NextResponse.json(simulations)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch simulations"
    console.error(`[Simulations] Error: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
