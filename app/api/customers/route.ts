import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { data, error } = await supabase
    .schema("public")
    .from("customer_master")
    .select("id, customer_name")
    .order("customer_name", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}