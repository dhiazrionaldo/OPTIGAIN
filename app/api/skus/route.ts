import { NextResponse } from "next/server"
import { getAllSKUs, createSKU } from "@/lib/supabase-admin-singlecompany"
/**
 * POST /api/skus
 * Creates a new SKU
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sku_code, product_name, category, base_price, base_cost } = body;
    if (!sku_code || !product_name || !category || base_price == null || base_cost == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const result = await createSKU(
      sku_code,
      product_name,
      category,
      Number(base_price),
      Number(base_cost)
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create SKU";
    console.error(`[SKUs] POST Error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/skus
 * Returns all SKUs in the system
 */
export async function GET() {
  try {
    const skus = await getAllSKUs()
    return NextResponse.json(skus)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch SKUs"
    console.error(`[SKUs] Error: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
