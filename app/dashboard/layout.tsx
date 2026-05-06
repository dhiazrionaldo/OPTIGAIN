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
        {/* --- DEKORASI BACKGROUND --- */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* 1. Grid yang lebih rapat untuk kesan tech-heavy */}
          <div 
            className="absolute inset-0 opacity-[0.04]" 
            style={{
              backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
              backgroundSize: "40px 40px" // Diperkecil sedikit agar grid lebih terlihat
            }} 
          />

          {/* 2. Primary Glow (Ungu) - Digeser lebih ke tengah atas agar terlihat di balik Card */}
          <div className="absolute top-[5%] left-[15%] w-[45%] h-[35%] rounded-full bg-primary/8 blur-[100px] animate-pulse" style={{ animationDuration: '8s' }} />
          
          {/* 3. Accent Glow (Teal) - Taruh di sisi kanan tengah agar menyeimbangkan visual */}
          <div className="absolute top-[20%] -right-[5%] w-[35%] h-[40%] rounded-full bg-accent/8 blur-[90px]" />

          {/* 4. Subtle Bottom Glow - Biar bagian bawah nggak kosong banget */}
          <div className="absolute bottom-0 left-[20%] w-[50%] h-[20%] rounded-full bg-primary/3 blur-[120px]" />
        </div>
        {/* Tombol Toggle Global (Muncul di Mobile & Desktop) */}
        {/* Anda bisa menaruh ini di dalam header/navbar atas Anda */}
        <header className="flex h-14 items-center px-4 border-b justify-between">
          <SidebarTrigger className="mr-2" />
          <DashboardHeader />
        </header>
        
        {/* Children Konten */}
        <div className="p-6 flex-1 mx-auto w-full ">
          <div className="relative inset-0 opacity-[0.05]" style={{
            backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
            backgroundSize: "48px 48px"
          }} />
          {children}
        </div>

      </main>
    </SidebarProvider>
  )
}
