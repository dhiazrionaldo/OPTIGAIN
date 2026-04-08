"use server"

import { createClient } from "@/lib/supabase/server"
import { parseExcelBuffer } from "@/lib/excel-parser"
import { triggerN8NWebhook } from "@/lib/n8n-webhook"
import { insertSalesPerformanceData } from "@/lib/sales-performance"
import { getRecentSalesPerformance, aggregateSalesData } from "@/lib/sales-performance"
import { getLatestCompanyForecast } from "@/lib/revenue-forecast"
import { getUserSimulations } from "@/lib/revenue-simulation"
import { redirect } from "next/navigation"

export async function uploadExcelAction(formData: FormData) {
    
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Not authenticated" }
  }

  const file = formData.get("file") as File
  if (!file || !file.name) {
    return { error: "No file provided" }
  }

  if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
    return { error: "Please upload a valid Excel file (.xlsx or .xls)" }
  }

  // Parse the Excel file
  const buffer = await file.arrayBuffer()
  const parseResult = parseExcelBuffer(buffer)

  if (!parseResult.success) {
    return { error: parseResult.errors.join(". ") }
  }

  if (parseResult.rows.length === 0) {
    return { error: "No valid data rows found in the file" }
  }
  
  // Create upload record (include sheet month/year if we parsed them)
  const uploadInsert: any = {
    user_id: user.id,
    file_name: file.name,
  }

  if (parseResult.sheetMonth != null) {
    uploadInsert.sheet_month = parseResult.sheetMonth
  }
  if (parseResult.sheetYear != null) {
    uploadInsert.sheet_year = parseResult.sheetYear
  }

  // DEBUG: Write parsed rows to a debug file before DB insert
    try {
      const fs = await import('fs/promises');
      await fs.appendFile(
        process.cwd() + '/debug-parsed-rows.log',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          file: file.name,
          rows: parseResult.rows
        }) + '\n'
      );
    } catch (e) {
      // Ignore file write errors in production
    }

  const { data: upload, error: uploadError } = await supabase
    .schema("public")
    .from("gross_profit_uploads")
    .insert(uploadInsert)
    .select()
    .single()
    
  if (uploadError || !upload) {
    console.log(uploadError)
    return { error: `Failed to create upload record: ${uploadError?.message || "Unknown error"}` }
  }

  // Insert rows (including sheet month/year for filtering by sheet/month)
  const rowsToInsert = parseResult.rows.map((row) => ({
    upload_id: upload.id,
    customer_name: row.customer_name,
    product_spec: row.product_spec,
    quantity: row.quantity,
    amount_sales: row.amount_sales,
    freight_cost: row.freight_cost,
    net_sales: row.net_sales,
    cogs: row.cogs,
    gross_margin_value: row.gross_margin_value,
    gross_margin_percent: row.gross_margin_percent,
    status: row.status,
    sheet_month: row.sheet_month || null,
    sheet_year: row.sheet_year || null,
  }))
 
  const { error: rowsError } = await supabase
    .schema("public")
    .from("gross_profit_rows")
    .insert(rowsToInsert)

  if (rowsError) {
    return { error: `Failed to insert rows: ${rowsError.message}` }
  }

  // Insert into sales_performance table (AI dataset)
  const { insertedCount, errors: insertErrors } = await insertSalesPerformanceData(
    parseResult.rows,
    user.id
  )

  if (insertErrors.length > 0) {
    console.warn("Warning: Failed to insert some sales_performance data:", insertErrors)
  }

  // Trigger N8N webhook - if it fails, rollback the inserted data
  try {
    await triggerN8NWebhook({
      upload_id: upload.id,
      user_id: user.id,
      row_count: parseResult.rows.length,
    })
  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error("N8N webhook failed, rolling back data:", errorMessage)
    
    // Rollback: Delete the inserted rows and upload record
    console.log(`Deleting rows for upload_id: ${upload.id}`)
    const { error: deleteRowsError } = await supabase
      .from("gross_profit_rows")
      .delete()
      .eq("upload_id", upload.id)
    
    if (deleteRowsError) {
      console.error("Failed to delete rows:", deleteRowsError)
      return { error: `Webhook failed and could not clean up rows: ${deleteRowsError.message}` }
    } else {
      console.log("Rows deleted successfully")
    }
    
    console.log(`Deleting upload record: ${upload.id}`)
    const { error: deleteUploadError } = await supabase
      .from("gross_profit_uploads")
      .delete()
      .eq("id", upload.id)
    
    if (deleteUploadError) {
      console.error("Failed to delete upload:", deleteUploadError)
      return { error: `Webhook failed and could not clean up upload record: ${deleteUploadError.message}` }
    } else {
      console.log("Upload record deleted successfully")
    }
    
    return { 
      error: `AI prediction service failed: ${errorMessage}` 
    }
  }

  redirect(`/dashboard/uploads/${upload.id}`)
}

export async function deleteFailedUploadAction(uploadId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Not authenticated" }
  }


  try {
    // Verify the upload belongs to the user
    const { data: upload } = await supabase
      .from("gross_profit_uploads")
      .select("id")
      .eq("id", uploadId)
      .eq("user_id", user.id)
      .single()

    if (!upload) {
      return { error: "Upload not found" }
    }

    // Delete the rows first
    const {error: deleteRowsError, count: rowsCount  } = await supabase
      .from("gross_profit_rows")
      .delete()
      .eq("upload_id", uploadId)
      
    console.log("Rows delete result:", { deleteRowsError, rowsCount })
      
    if (deleteRowsError) {
      console.error("Failed to delete rows:", deleteRowsError)
      return { error: `Failed to delete rows: ${deleteRowsError.message}` }
    }

    // Delete the upload record
    const {error: deleteUploadError, count: uploadCount } = await supabase
      .from("gross_profit_uploads")
      .delete()
      .eq("id", uploadId)
    
    console.log("Upload delete result:", { deleteUploadError, uploadCount })

    if (deleteUploadError) {
      console.error("Failed to delete upload:", deleteUploadError)
      return { error: `Failed to delete upload: ${deleteUploadError.message}` }
    }
  } catch (error) {
    return error instanceof Error ? { error: error.message } : { error: "Unknown error" }
  } 
    
    return { success: true }
  
}

export async function getDashboardMetrics() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Unauthorized" }
  }

  try {
    // Fetch recent sales data
    const salesData = await getRecentSalesPerformance(user.id, 24)
    
    if (salesData.length === 0) {
      return {
        latestRevenue: 0,
        latestMargin: 0,
        revenueGrowth: 0,
        forecastRevenue: 0,
        forecastMargin: 0,
        trendData: [],
        topProducts: [],
        topCustomers: [],
      }
    }

    // Aggregate data
    const aggregated = aggregateSalesData(salesData)

    // Calculate latest metrics
    const latestMonth = aggregated.monthly[aggregated.monthly.length - 1]
    const previousMonth = aggregated.monthly[aggregated.monthly.length - 2]

    const latestRevenue = latestMonth?.total_revenue || 0
    const latestMargin = latestMonth
      ? (latestMonth.total_margin / latestMonth.total_revenue) * 100
      : 0
    const revenueGrowth =
      previousMonth && previousMonth.total_revenue > 0
        ? ((latestRevenue - previousMonth.total_revenue) / previousMonth.total_revenue) * 100
        : 0

    // Get forecast
    const forecast = await getLatestCompanyForecast(user.id)

    // Get top products and customers
    const topProducts = aggregated.products
      .slice(0, 10)
      .map((p) => ({
        name: p.product_variant,
        value: Array.from(p.periods.values()).reduce((sum, period) => sum + period.revenue, 0),
      }))
      .sort((a, b) => b.value - a.value)

    const topCustomers = aggregated.customers
      .slice(0, 10)
      .map((c) => ({
        name: c.customer_name,
        value: Array.from(c.periods.values()).reduce((sum, period) => sum + period.revenue, 0),
      }))
      .sort((a, b) => b.value - a.value)

    return {
      latestRevenue,
      latestMargin,
      revenueGrowth,
      forecastRevenue: forecast?.predicted_revenue || 0,
      forecastMargin: forecast?.predicted_margin || 0,
      aiReasoning: forecast?.ai_reasoning || "",
      aiSuggestions: forecast?.ai_suggestions || "",
      trendData: aggregated.monthly,
      topProducts,
      topCustomers,
    }
  } catch (err) {
    console.error("Error getting dashboard metrics:", err)
    return { error: "Failed to load metrics" }
  }
}

export async function getSimulationBaseline() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Unauthorized" }
  }

  try {
    const forecast = await getLatestCompanyForecast(user.id)
    const simulations = await getUserSimulations(user.id)

    return {
      baseline: forecast,
      simulations,
    }
  } catch (err) {
    console.error("Error getting simulation data:", err)
    return { error: "Failed to load simulation data" }
  }
}
