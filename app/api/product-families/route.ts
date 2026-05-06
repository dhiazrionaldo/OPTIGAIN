import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { data, error } = await supabase
    .schema("public")
    .from("product_master")
    .select("family")
    .order("family", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Deduplicate families since multiple products can share the same family
  const uniqueFamilies = [...new Set(data.map((r) => r.family).filter(Boolean))]

  return NextResponse.json(uniqueFamilies.map((f) => ({ family: f })))
}