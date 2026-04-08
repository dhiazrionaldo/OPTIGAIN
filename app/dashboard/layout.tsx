import { DashboardSidebar } from "@/components/layout/dashboard-sidebar"
import { DashboardHeader } from "@/components/layout/dashboard-header"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      {/* Sidebar yang tadi dibuat */}
      <DashboardSidebar />
      
      {/* Area Konten Utama */}
      <main className="flex-1 min-w-0 w-full overflow-y-auto overflow-x-hidden p-4 contain-content">
        
        {/* Tombol Toggle Global (Muncul di Mobile & Desktop) */}
        {/* Anda bisa menaruh ini di dalam header/navbar atas Anda */}
        <header className="flex h-14 items-center px-4 border-b justify-between">
          <SidebarTrigger className="mr-2" />
          <DashboardHeader />
        </header>
        
        {/* Children Konten */}
        <div className="p-6 flex-1 mx-auto w-full ">
          {children}
        </div>

      </main>
    </SidebarProvider>
  )
}
