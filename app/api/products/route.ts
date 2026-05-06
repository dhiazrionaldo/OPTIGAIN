import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const family      = searchParams.get("family")

  let query = supabase
    .schema("public")
    .from("product_master")
    .select("id, product_name, family")
    .order("product_name", { ascending: true })

  if (family)      query = query.eq("family", family)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}