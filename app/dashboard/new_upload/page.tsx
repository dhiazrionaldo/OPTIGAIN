import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { UploadCard } from "@/components/upload/upload-card"
import { FileSpreadsheet, Zap, Layers, GitBranch, CalendarDays } from "lucide-react" // Tambah CalendarDays biar iconnya nyambung
import { Button } from "@/components/ui/button"

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // 1. Hitung total upload
  const { count: uploadCount } = await supabase
    .from("gross_profit_uploads")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)

  const { data: userUploads } = await supabase
    .from("gross_profit_uploads")
    .select("id")
    .eq("user_id", user.id)

  const uploadIds = (userUploads || []).map((u) => u.id)

  let rowCount = 0
  let aiCount = 0

  if (uploadIds.length > 0) {
    // 2. Hitung Total Data Rows
    const { count: rc } = await supabase
      .from("gross_profit_rows")
      .select("*", { count: "exact", head: true })
      .in("upload_id", uploadIds)
    rowCount = rc || 0

    // 3. LOGIKA BARU: Hitung Bulan Unik (Month Data)
    const { data: monthData, error: monthError } = await supabase
      .from("gross_profit_rows")
      .select("sheet_month, sheet_year") // Hanya ambil 2 kolom ini biar ringan
      .in("upload_id", uploadIds)

    if (!monthError && monthData) {
      // Gunakan Set untuk membuang duplikat otomatis
      const uniqueMonths = new Set()
      
      for (const row of monthData) {
        // Pastikan datanya tidak null/0
        if (row.sheet_month && row.sheet_year) {
          // Gabungkan jadi key unik, contoh: "2026-3"
          uniqueMonths.add(`${row.sheet_year}-${row.sheet_month}`)
        }
      }
      
      // Ukuran dari Set adalah jumlah bulan unik yang kita punya
      aiCount = uniqueMonths.size
    }
  }

  const stats = [
    {
      label: "Total Uploads",
      value: uploadCount || 0,
      icon: FileSpreadsheet,
      accent: "text-primary bg-primary/10 ring-primary/20",
    },
    {
      label: "Data Rows",
      value: rowCount,
      icon: Layers,
      accent: "text-accent bg-accent/10 ring-accent/20",
    },
    {
      label: "Month Coverage", // Label diganti sedikit biar lebih make sense
      value: aiCount,
      icon: CalendarDays, // Icon pakai kalender agar lebih relevan
      accent: "text-orange-500 bg-orange-500/10 ring-orange-500/20",
    },
  ]

  return (
    <div className="flex flex-col gap-4 sm:gap-6 md:gap-2">
      {/* Page header */}
      <div className="flex flex-col-2 justify-between gap-2 sm:gap-4 md:gap-6">
        <div className="flex flex-col gap-0.5 sm:gap-1">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-xs sm:text-sm md:text-base text-muted-foreground">
            Upload and analyze your gross profit data with AI.
          </p>
        </div>
        <div className="space-y-3 flex flex-col">
          <a href="/templates/optigain-template.xlsx"
             download
             className="ml-auto"
          >
            <Button variant="outline" size="sm" className="h-8 sm:h-9 md:h-10 px-3 sm:px-4 md:px-6 text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-medium border-0">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Get Template
            </Button>
          </a>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="group relative flex items-center gap-3 sm:gap-4 rounded-lg sm:rounded-xl border border-border bg-card/60 backdrop-blur-sm p-3 sm:p-4 md:p-5 transition-all duration-200 hover:border-border/80 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className={`flex h-9 sm:h-10 md:h-11 w-9 sm:w-10 md:w-11 shrink-0 items-center justify-center rounded-lg sm:rounded-xl ring-1 ${stat.accent}`}>
              <stat.icon className="h-4 sm:h-4.5 md:h-5 w-4 sm:w-4.5 md:w-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-widest">{stat.label}</span>
              <span className="text-lg sm:text-xl md:text-2xl font-black tracking-tight text-foreground">{stat.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Upload section */}
      <UploadCard />
    </div>
  )
}