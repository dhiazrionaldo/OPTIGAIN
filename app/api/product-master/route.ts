import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { data, error } = await supabase
    .schema("public")
    .from("product_master")
    .select(`
      id,
      family,
      product_name,
      is_pareto
    `)
    .order("created_at", { ascending: false })
    
  if (error) {
    console.error("Supabase error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = await request.json()
  const { id, product_name, family, is_pareto } = body

  if (!product_name)  return NextResponse.json({ error: "product_name is required" },  { status: 400 })
  if (!family)        return NextResponse.json({ error: "family is required" },        { status: 400 })
  if (is_pareto === undefined) return NextResponse.json({ error: "is_pareto is required" }, { status: 400 })

  const { data, error } = await supabase
    .schema("public")
    .from("product_master")
    .upsert({ 
      ...(id && { id }), // ← kalau ada id, ikutkan (update). kalau tidak ada, insert baru
      product_name, 
      family, 
      is_pareto 
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}

export async function PUT(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = await request.json()
  const { product_name, family, is_pareto } = body

  if (!product_name)  return NextResponse.json({ error: "product_name is required" },  { status: 400 })
  if (!family)        return NextResponse.json({ error: "family is required" },        { status: 400 })
  if (is_pareto === undefined) return NextResponse.json({ error: "is_pareto is required" }, { status: 400 })

  const { data, error } = await supabase
    .schema("public")
    .from("product_master")
    .update({ product_name, family, is_pareto })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
export async function DELETE(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const { error } = await supabase
    .schema("public")
    .from("product_master")
    .delete()
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}