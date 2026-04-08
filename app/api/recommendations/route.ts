import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const upload_id = searchParams.get("upload_id")
    if (!upload_id) {
      return NextResponse.json({ success: false, error: "Missing upload_id" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("ai_recommendations")
      .select("*")
      .eq("upload_id", upload_id)

    if (error) {
      console.error("recommendations API error", error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, recommendations: data || [] })
  } catch (err) {
    console.error("recommendations API unexpected error", err)
    return NextResponse.json({ success: false, error: "Unexpected error" }, { status: 500 })
  }
}
