import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  // Get unique categories from sales data (gross_profit_rows)
  const { data, error } = await supabase
    .from("gross_profit_rows")
    .select("category")
    .neq("category", null);
  if (error) return NextResponse.json([], { status: 500 });
  // Extract unique categories
  const categories = Array.from(new Set((data || []).map((row: any) => row.category).filter(Boolean)));
  return NextResponse.json(categories);
}
