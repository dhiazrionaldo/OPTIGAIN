import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  // Get unique product_spec from gross_profit_rows
  const { data, error } = await supabase
    .from("gross_profit_rows")
    .select("product_spec")
    .neq("product_spec", null);
  if (error) return NextResponse.json([], { status: 500 });
  // Extract unique product_spec
  const specs = Array.from(new Set((data || []).map((row: any) => row.product_spec).filter(Boolean)));
  return NextResponse.json(specs);
}
