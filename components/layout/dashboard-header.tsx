import { createClient } from "@/lib/supabase/server"

export async function DashboardHeader() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const initials = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : "U"

  return (
    <header className="flex h-12 sm:h-14 md:h-16 items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-3 sm:px-4 md:px-6">
      <div />
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex flex-col items-end min-w-0">
          <span className="text-[10px] sm:text-xs font-medium text-foreground truncate max-w-[120px] sm:max-w-none">{user?.email}</span>
          <span className="text-[8px] sm:text-[10px] text-muted-foreground">Active</span>
        </div>
        <div className="flex h-8 sm:h-9 w-8 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-primary/15 ring-1 ring-primary/25 text-[10px] sm:text-xs font-semibold text-primary shrink-0">
          {initials}
        </div>
      </div>
    </header>
  )
}
