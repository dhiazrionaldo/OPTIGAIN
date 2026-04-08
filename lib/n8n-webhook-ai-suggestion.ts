import { createClient } from "@/lib/supabase/server"

export interface WebhookPayload {
  upload_id: string
  user_id: string
  row_count: number
}

export interface AIRecommendations {
  original_row_id: string
  upload_id: string
  customer_name: string
  product_spec: string
  suggested_amount_sales: number
  suggested_freight_cost: number
  suggested_cogs: number
  predicted_net_sales: number
  predicted_gm_value: number
  predicted_gm_percent: number
  suggested_quantity: number
  action: string
  confidence_score: number
  needs_manager_review: boolean
  replaced_from: string | null
  reason: string
  prediction_month: number
  prediction_year: number
  prediction_period_label: string
}

function getStatusMessage(status: number): string {
  const statusMessages: Record<number, string> = {
    400: "Invalid request to AI service",
    401: "AI service authentication failed",
    403: "Access denied to AI service",
    404: "AI prediction service not found",
    429: "Too many requests - please try again later",
    500: "AI service encountered an error",
    502: "AI service temporarily unavailable",
    503: "AI service is temporarily down for maintenance",
    504: "AI service request timed out",
  }
  return statusMessages[status] || `AI service error (Status: ${status})`
}

async function updateAIRecommendations(rows: AIRecommendations[]): Promise<void> {
  const supabase = await createClient() 
  const updatePromises = rows.map(async (row) => {
    
    const { data, error } = await supabase
      .from("ai_recommendations")
      .update({
        customer_name: row.customer_name,
        product_spec: row.product_spec,
        suggested_amount_sales: row.suggested_amount_sales,
        suggested_freight_cost: row.suggested_freight_cost,
        suggested_cogs: row.suggested_cogs,
        predicted_net_sales: row.predicted_net_sales,
        predicted_gm_value: row.predicted_gm_value,
        predicted_gm_percent: row.predicted_gm_percent,
        suggested_quantity: row.suggested_quantity,
        action: row.action,
        confidence_score: row.confidence_score,
        needs_manager_review: row.needs_manager_review,
        replaced_from: row.replaced_from,
        reason: row.reason
      })
      .eq("id", row.original_row_id)  // ← fix
      .eq("upload_id", row.upload_id)               // ← fix
      .select()

    if (error) {
      console.error(`Failed to update row ${row.original_row_id}:`, error.message)  // ← fix
      throw new Error(`Supabase update failed for row ${row.original_row_id}: ${error.message}`)  // ← fix
    }

    if (!data || data.length === 0) {
      console.warn(`⚠️ No matching row — original_row_id: ${row.original_row_id}, upload_id: ${row.upload_id}`)  // ← fix
    }
  })

  await Promise.all(updatePromises)
  console.log(`Successfully updated ${rows.length} rows`)
}

export async function triggerN8NWebhookAISuggestion(payload: WebhookPayload): Promise<void> {
  // const webhookUrl = process.env.N8N_WEBHOOK_URL_PREDICTION_INLINE

  // if (!webhookUrl) {
  //   const error = "N8N_WEBHOOK_URL_PREDICTION_INLINE is not configured"
  //   console.error(error)
  //   throw new Error(error)
  // }
  const webhookUrl = process.env.N8N_WEBHOOK_URL

  if (!webhookUrl) {
    const error = "N8N_WEBHOOK_URL is not configured"
    console.error(error)
    throw new Error(error)
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 min timeout
    console.log("Triggering N8N webhook with payload:", payload)

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const userMessage = getStatusMessage(response.status)
      console.error(`N8N webhook error: ${userMessage}`)
      throw new Error(userMessage)
    }

    // ✅ Parse n8n response body (returns array of AI recommendation rows)
    const responseBody = await response.json()
    
    
    // ✅ Update Supabase directly instead of relying on n8n node
    await updateAIRecommendations((Array.isArray(responseBody) ? responseBody : [responseBody]) as AIRecommendations[])

  } catch (error: any) {
    if (error?.name === "AbortError") {
      const timeoutMsg = "AI service request timed out"
      console.error("N8N webhook error:", timeoutMsg)
      throw new Error(timeoutMsg)
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error("N8N webhook error:", message)
    throw error
  }
}

// export async function triggerN8NWebhookAISuggestion(payload: WebhookPayload): Promise<void> {
//   const webhookUrl = process.env.N8N_WEBHOOK_URL_PREDICTION_INLINE


//   if (!webhookUrl) {
//     const error = "N8N_WEBHOOK_URL_PREDICTION_INLINE is not configured"
//     console.error(error)
//     throw new Error(error)
//   }

//   try {
//     const controller = new AbortController()
//     const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 minute timeout
//     console.log("Triggering N8N webhook with payload:", payload)
    
//     const response = await fetch(webhookUrl, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(payload),
//       signal: controller.signal,
//     })

//     clearTimeout(timeoutId)

//     if (!response.ok) {
//       const userMessage = getStatusMessage(response.status)
//       console.error(`N8N webhook error: ${userMessage}`)
//       throw new Error(userMessage)
//     }
    
//     console.log("N8N webhook triggered successfully")
//   } catch (error: any) {
//     // Handle AbortError from timeout
//     if (error?.name === "AbortError") {
//       const timeoutMsg = "AI service request timed out (10 seconds)"
//       console.error("N8N webhook error:", timeoutMsg)
//       throw new Error(timeoutMsg)
//     }
    
//     const message = error instanceof Error ? error.message : String(error)
//     console.error("N8N webhook error:", message)
//     throw error
//   }
// }
