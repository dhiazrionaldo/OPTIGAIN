import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import { ComparisonView } from "@/components/tables/comparison-view"
import { FailedUploadError } from "@/components/upload/failed-upload-error"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft, FileSpreadsheet } from "lucide-react"

export const dynamic = "force-dynamic"

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

  // fetch upload, then cast to known type
  const { data: upload, error: uploadError } = await supabase
    .from("gross_profit_uploads")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()
  const uploadTyped = upload as import("@/lib/database.types").GrossProfitUpload | null

  if (!uploadTyped) {
    notFound()
  }

  // fetch rows and current recommendations in parallel for speed
  const [rowsResp] = await Promise.all([
    supabase
      .from("gross_profit_rows")
      .select("*")
      .eq("upload_id", id)
      .order("customer_name")
  ])
  const rowsTyped = (rowsResp.data as unknown) as import("@/lib/database.types").GrossProfitRow[] | null

  const hasError = !rowsTyped && rowsTyped!.length < 0 
  
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="h-8 gap-2 text-muted-foreground hover:text-foreground hover:bg-muted">
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
          <h1 className="text-xl font-bold tracking-tight text-foreground">{uploadTyped?.file_name}</h1>
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
          rows={rowsTyped || []}
          recommendations={[]}
        />
      )}
    </div>
  )
}
