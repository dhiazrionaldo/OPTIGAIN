import { NextRequest, NextResponse } from "next/server"
import { triggerN8NWebhook } from "@/lib/n8n-webhook"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { upload_id, action } = body as {
      upload_id: string
      action: string
    }

    if (!upload_id) {
      return NextResponse.json({ success: false, error: "Missing upload_id" }, { status: 400 })
    }

    // Trigger n8n webhook for the entire upload
    triggerN8NWebhook({ upload_id, action }).catch((e) => {
      console.error("Failed to call n8n on manual refresh", e)
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("trigger-predictions API error", err)
    return NextResponse.json({ success: false, error: "Unexpected error" }, { status: 500 })
  }
}
