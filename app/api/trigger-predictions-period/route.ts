import { NextRequest, NextResponse } from "next/server"
import { triggerN8NWebhook } from "@/lib/n8n-webhook"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { upload_id, action, period } = body as {
      upload_id: string
      action: string
      period: number
    }

    if (!upload_id) {
      return NextResponse.json({ success: false, error: "Missing upload_id" }, { status: 400 })
    }
    
    await triggerN8NWebhook({ upload_id, action, period })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("trigger-predictions API error", err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
// export async function POST(req: NextRequest) {
//   try {
//     const body = await req.json()
//     const { upload_id, action, period } = body as {
//       upload_id: string
//       action: string
//       period: string
//     }

//     if (!upload_id) {
//       return NextResponse.json({ success: false, error: "Missing upload_id" }, { status: 400 })
//     }
    
//     // ✅ Await the webhook so errors are caught by the try/catch above
//     await triggerN8NWebhook({ upload_id, action, period }).catch((e) => {
//       console.error("Failed to call AI on manual refresh", e)
//       return NextResponse.json({ success: false, error: e.message }, { status: 500 })
//     })

//     return NextResponse.json({ success: true })
//   } catch (err: any) {
//     console.error("trigger-predictions API error", err)
//     const message = err instanceof Error ? err.message : String(err)
//     // ✅ Return the actual error message so the frontend can display it
//     return NextResponse.json({ success: false, error: err.message }, { status: 500 })
//   }
// }