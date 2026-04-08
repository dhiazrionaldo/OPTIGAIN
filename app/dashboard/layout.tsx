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
      <main className="flex flex-1 flex-col w-full relative">
        
        {/* Tombol Toggle Global (Muncul di Mobile & Desktop) */}
        {/* Anda bisa menaruh ini di dalam header/navbar atas Anda */}
        <header className="flex h-14 items-center px-4 border-b">
          <SidebarTrigger className="mr-2" />
          <h1 className="font-semibold text-sm">Dashboard Overview</h1>
        </header>
        
        {/* Children Konten */}
        <div className="p-6 flex-1 mx-auto w-full ">
          {children}
        </div>

      </main>
    </SidebarProvider>
    // <div className="flex h-screen overflow-hidden bg-background">
    //   <DashboardSidebar />
    //   <div className="flex flex-1 flex-col overflow-hidden w-full">
    //     <DashboardHeader />
    //     <main className="flex-1 overflow-y-auto p-2 sm:p-1 md:p-1 lg:p-1.5">
    //       <div className="mx-auto w-full ">
    //         {children}
    //       </div>
    //     </main>
    //   </div>
    // </div>
  )
}
