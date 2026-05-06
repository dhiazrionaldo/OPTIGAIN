import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { data, error } = await supabase
    .schema("public")
    .from("product_mappings")
    .select(`
      id,
      priority,
      product_id,
      to_product_id,
      original_product:product_master!product_id (product_name, family),
      to_product:product_master!to_product_id (product_name, family)
    `)
    .order("priority", { ascending: true })

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
  const { product_id, to_product_id, priority } = body

  if (!product_id)    return NextResponse.json({ error: "product_id is required" },    { status: 400 })
  if (!to_product_id) return NextResponse.json({ error: "to_product_id is required" }, { status: 400 })

  const { data, error } = await supabase
    .schema("public")
    .from("product_mappings")
    .insert({ product_id, to_product_id, priority })
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
    .from("product_mapping")
    .delete()
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// import { createClient } from "@/lib/supabase/server"
// import { NextResponse } from "next/server"

// export async function GET() {
//   const supabase = await createClient()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

//   const { data, error } = await supabase
//     .schema("public")
//     .from("product_mapping")
//     .select(`
//       id,
//       priority,
//       customer_id,
//       product_id,
//       to_product_id,
//       customer_master (customer_name),
//       product_master (product_name, family)
//     `)
//     .order("priority", { ascending: true })
    
//   if (error) {
//     console.error("Supabase error:", error)
//     return NextResponse.json({ error: error.message }, { status: 500 })
//   }

//   return NextResponse.json(data ?? [])
// }

// export async function POST(request: Request) {
//   const supabase = await createClient()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

//   const body = await request.json()
//   const { product_id, customer_id, priority, to_product_id } = body

//   // Validate
//   if (!product_id)              return NextResponse.json({ error: "product_id is required" },  { status: 400 })
//   if (!customer_id)             return NextResponse.json({ error: "customer_id is required" }, { status: 400 })
//   if (typeof priority !== "number") return NextResponse.json({ error: "priority must be a number" }, { status: 400 })
//   if (!to_product_id)            return NextResponse.json({ error: "to_product_id is required" }, { status: 400 })

//   const { data, error } = await supabase
//     .schema("public")
//     .from("product_mapping")
//     .insert({ product_id, customer_id, priority, to_product_id })  
//     .select()
//     .single()

//   if (error) return NextResponse.json({ error: error.message }, { status: 500 })

//   return NextResponse.json(data, { status: 201 })
// }