export interface WebhookPayload {
  upload_id: string
  user_id: string
  row_count: number
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

export async function triggerN8NWebhook(payload: WebhookPayload): Promise<void> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL

  if (!webhookUrl) {
    const error = "N8N_WEBHOOK_URL is not configured"
    console.error(error)
    throw new Error(error)
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout
    console.log("Triggering N8N webhook with payload:", payload)
    
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const userMessage = getStatusMessage(response.status)
      console.error(`N8N webhook error: ${userMessage}`)
      throw new Error(userMessage)
    }
    
    console.log("N8N webhook triggered successfully")
  } catch (error: any) {
    // Handle AbortError from timeout
    if (error?.name === "AbortError") {
      const timeoutMsg = "AI service request timed out (10 seconds)"
      console.error("N8N webhook error:", timeoutMsg)
      throw new Error(timeoutMsg)
    }
    
    const message = error instanceof Error ? error.message : String(error)
    console.error("N8N webhook error:", message)
    throw error
  }
}
