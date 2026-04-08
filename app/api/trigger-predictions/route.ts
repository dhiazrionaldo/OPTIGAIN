import { NextRequest, NextResponse } from "next/server"
import { triggerN8NWebhook } from "@/lib/n8n-webhook"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { upload_id, action, periods } = body as {
      upload_id: string
      action: string
      periods: string
    }

    if (!upload_id) {
      return NextResponse.json({ success: false, error: "Missing upload_id" }, { status: 400 })
    }

    // Trigger n8n webhook for the entire upload
    await triggerN8NWebhook({ upload_id, action, periods }).catch((e) => { 
      console.error("Webhook threw:", e.message) 
      throw e  // re-throw so the catch block below catches it
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("trigger-predictions API error", err)
    return NextResponse.json({ success: false, error: "Unexpected error" }, { status: 500 })
  }
}
