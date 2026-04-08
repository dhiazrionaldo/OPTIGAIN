import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { triggerN8NWebhook } from "@/lib/n8n-webhook"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { rowId, product_spec, quantity, upload_id } = body as {
      rowId: string
      product_spec?: string
      quantity?: number
      upload_id: string
    }

    console.log("update-row API received:", { rowId, product_spec, quantity, upload_id })

    if (!rowId || !upload_id) {
      return NextResponse.json({ success: false, error: "Missing identifiers" }, { status: 400 })
    }

    const supabase = await createClient()
    
    // First, verify the row exists and is accessible
    console.log("Verifying row exists...")
    const { data: existingRow, error: selectError } = await supabase
      .from("gross_profit_rows")
      .select("id, upload_id, quantity")
      .eq("id", rowId)
      .eq("upload_id", upload_id)
      .single()

    if (selectError) {
      console.error("Error checking if row exists:", {
        message: selectError.message,
        code: selectError.code,
        hint: (selectError as any).hint
      })
      return NextResponse.json({ 
        success: false, 
        error: `Row not found or not accessible: ${selectError.message}`,
        details: "Make sure the row ID and upload ID are correct"
      }, { status: 404 })
    }

    if (!existingRow) {
      console.warn("Row does not exist:", { rowId, upload_id })
      return NextResponse.json({ 
        success: false, 
        error: "Row not found",
        debug: { rowId, upload_id }
      }, { status: 404 })
    }

    console.log("Row found, current values:", existingRow)
    
    // Build update object with only provided fields
    const updateData: Record<string, any> = {}
    if (product_spec !== undefined) updateData.product_spec = product_spec
    if (quantity !== undefined) updateData.quantity = quantity
    
    console.log("Attempting to update row with data:", { rowId, updateData })
    
    const { error: updateError, data, count } = await supabase
      .from("gross_profit_rows")
      .update(updateData)
      .eq("id", rowId)
      .eq("upload_id", upload_id)
      .select()

    console.log("Supabase update result:", { error: updateError, dataLength: data?.length, count })

    if (updateError) {
      console.error("Supabase update error details:", { 
        message: updateError.message, 
        code: updateError.code,
        hint: (updateError as any).hint
      })
      return NextResponse.json({ 
        success: false, 
        error: updateError.message,
        details: (updateError as any).hint || (updateError as any).details
      }, { status: 500 })
    }

    if (!data || data.length === 0) {
      console.warn("Update returned no rows - row may not exist or RLS may be blocking", {
        rowId,
        upload_id,
        updateData,
        existingRowId: existingRow.id
      })
      return NextResponse.json({ 
        success: false, 
        error: "Update failed - no rows affected",
        debug: { rowId, upload_id, rowFoundButNotUpdated: true }
      }, { status: 400 })
    }

    console.log("Update successful, updated row:", data[0])

    // fetch current AI recommendations for this upload (may be stale until webhook completes)
    const { data: recos, error: recoError } = await supabase
      .from("ai_recommendations")
      .select("*")
      .eq("upload_id", upload_id)

    if (recoError) {
      console.error("Failed to load recommendations after update", recoError)
    }

    // re-run prediction for this upload
    triggerN8NWebhook({ upload_id, row_id: rowId, action: "row_updated" }).catch((e) => {
      console.error("Failed to call n8n after row update", e)
    })

    return NextResponse.json({ success: true, data: data[0], recommendations: recos || [] })
  } catch (err) {
    console.error("update-row API error", err)
    return NextResponse.json({ success: false, error: "Unexpected error", details: String(err) }, { status: 500 })
  }
}
