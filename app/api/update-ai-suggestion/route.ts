import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { triggerN8NWebhookAISuggestion } from "@/lib/n8n-webhook-ai-suggestion"

export async function POST(req: NextRequest) {
  // Check if n8n webhook is active before updating
  // const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL_PREDICTION_PERIOD || '';
  // let n8nOk = false;
  // if (n8nWebhookUrl) {
  //   try {
  //     const resp = await fetch(n8nWebhookUrl, { method: 'HEAD' });
  //     n8nOk = resp.ok;
  //   } catch (e) {
  //     n8nOk = false;
  //   }
  // }
  //   // Check if n8n webhook is active before updating (POST with empty payload)
  //   if (n8nWebhookUrl) {
  //     try {
  //       const resp = await fetch(n8nWebhookUrl, {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({ healthcheck: true })
  //       });
  //       n8nOk = resp.ok;
  //     } catch (e) {
  //       n8nOk = false;
  //     }
  //   }
  //   if (!n8nOk) {
  //     return NextResponse.json({ success: false, error: "n8n webhook is not active or unreachable" }, { status: 503 });
  // }
  try {
    const body = await req.json()
    const { recoId, reco } = body as { recoId: string, reco: { suggested_quantity?: number | null } | Array<any> }

    if (!recoId) {
      return NextResponse.json({ success: false, error: "Missing recoId" }, { status: 400 })
    }

    // Reject if reco is an array
    if (Array.isArray(reco)) {
      return NextResponse.json({ success: false, error: "Only a single reco object is allowed." }, { status: 400 })
    }

    // ✅ Fix — guard before calling
    if (reco?.suggested_quantity === undefined) {
      return NextResponse.json({ success: false, error: "Missing suggested_quantity" }, { status: 400 })
    }

    // Update suggested_quantity in ai_recommendations table for the specific row
    const supabase = await createClient()
    const { error: updateError, count } = await supabase
      .from("ai_recommendations")
      .update({ suggested_quantity: reco?.suggested_quantity })
      .eq("original_row_id", recoId)

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
    }

    // ✅ Add this
    if (count === 0) {
      return NextResponse.json({ success: false, error: "No rows updated — check RLS policies or recoId" }, { status: 404 })
    }

    // Optionally trigger webhook here if needed
    const n8n = await triggerN8NWebhookAISuggestion(body)
    
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("update-ai-suggestion API error", err)
    const message = err instanceof Error ? err.message : String(err)
    // ✅ Returns a real 500 so response.ok is false on the frontend
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}