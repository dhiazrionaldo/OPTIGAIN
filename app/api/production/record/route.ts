import { NextRequest, NextResponse } from "next/server"
import { CreateProductionRowSchema } from "@/lib/validators-singlecompany"
import { createProductionRow } from "@/lib/supabase-admin-singlecompany"

/**
 * POST /api/production/record
 * Creates a new production row
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = CreateProductionRowSchema.parse(body)

    const result = await createProductionRow(
      validated.sku_id,
      validated.production_date,
      validated.quantity,
      validated.production_cost
    )

    return NextResponse.json({
      success: true,
      production_id: result.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create production record"
    console.error(`[Production Record] Error: ${message}`)
    return NextResponse.json(
      { success: false, error: message },
      { status: error instanceof Error && message.includes("validation") ? 400 : 500 }
    )
  }
}
