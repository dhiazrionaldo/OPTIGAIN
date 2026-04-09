import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { UploadsTable } from "@/components/tables/uploads-table"
import { Button } from "@/components/ui/button";

export default async function UploadsPage({ searchParams }: { searchParams: Promise<{ month?: string; year?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  let query = supabase
    .from("gross_profit_uploads")
    .select("*")
    .eq("user_id", user.id)

  // apply month/year filtering if provided in the url
  if (params?.month) {
    const m = parseInt(params.month, 10)
    if (!isNaN(m)) {
      query = query.eq("sheet_month", m)
    }
  }
  if (params?.year) {
    const y = parseInt(params.year, 10)
    if (!isNaN(y)) {
      query = query.eq("sheet_year", y)
    }
  }

  const { data: uploads } = await query.order("uploaded_at", { ascending: false })

  const uploadsWithCounts = await Promise.all(
    (uploads || []).map(async (upload: any) => {
      const { count } = await supabase
        .from("gross_profit_rows")
        .select("*", { count: "exact", head: true })
        .eq("upload_id", upload.id)

      return {
        ...upload,
        row_count: count || 0,
      }
    })
  )

  // build options for the simple form
  const months = [
    "All Months", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ]

  const currentYear = 2026
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Uploads</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and manage your uploaded gross profit data files.
        </p>
      </div>
      <form method="get" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Filter by:</label>
        <select
          name="month"
          defaultValue={params?.month || ""}
          className="h-9 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          {months.map((m, idx) => (
            <option key={idx} value={idx === 0 ? "" : idx}>{m}</option>
          ))}
        </select>
        <select
          name="year"
          defaultValue={params?.year || currentYear}
          className="h-9 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          <option value="">All Years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          type="submit"
          className="ml-auto h-9 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Apply
        </button>
      </form>
      <UploadsTable uploads={uploadsWithCounts} />
    </div>
  )
}
