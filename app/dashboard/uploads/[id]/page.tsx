import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import { ComparisonView } from "@/components/tables/comparison-view"
import { FailedUploadError } from "@/components/upload/failed-upload-error"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft, FileSpreadsheet } from "lucide-react"

async function waitForRecommendations(supabase: any, uploadId: string, maxWaitMs = 120000) {
  const startTime = Date.now()
  const pollInterval = 2000 // Poll every 2 seconds
  
  while (Date.now() - startTime < maxWaitMs) {
    const { data: recommendations, count } = await supabase
      .from("ai_recommendations")
      .select("*", { count: "exact" })
      .eq("upload_id", uploadId)
    
    // If we have recommendations, return them
    if (recommendations && recommendations.length > 0) {
      return recommendations
    }
    
    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }
  
  // Timeout reached, return empty array
  return []
}

export default async function UploadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: upload } = await supabase
    .from("gross_profit_uploads")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (!upload) {
    notFound()
  }

  const { data: rows } = await supabase
    .from("gross_profit_rows")
    .select("*")
    .eq("upload_id", id)
    .order("customer_name")

  // Wait for AI recommendations to be populated (max 2 minutes)
  const recommendations = await waitForRecommendations(supabase, id)

  // If we have rows but no recommendations after timeout, show error
  const hasError = rows && rows.length > 0 && (!recommendations || recommendations.length === 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="h-8 gap-2 text-muted-foreground hover:text-foreground">
          <Link href="/dashboard/uploads">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{upload.file_name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Side-by-side comparison of original data and AI recommendations
          </p>
        </div>
      </div>

      {hasError ? (
        <FailedUploadError uploadId={id} />
      ) : (
        <ComparisonView
          uploadId={id}
          rows={rows || []}
          recommendations={recommendations || []}
        />
      )}
    </div>
  )
}
