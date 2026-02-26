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

    if (!rowId || !upload_id) {
      return NextResponse.json({ success: false, error: "Missing identifiers" }, { status: 400 })
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from("gross_profit_rows")
      .update({ product_spec, quantity })
      .eq("id", rowId)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // re-run prediction for this upload (and optionally just that row)
    triggerN8NWebhook({ upload_id, row_id: rowId, action: "row_updated" }).catch((e) => {
      console.error("Failed to call n8n after row update", e)
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("update-row API error", err)
    return NextResponse.json({ success: false, error: "Unexpected error" }, { status: 500 })
  }
}
