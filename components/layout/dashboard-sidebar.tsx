"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { logout } from "@/app/(auth)/actions"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Upload, FolderOpen, LogOut, TrendingUp, ChevronRight, Menu, X } from "lucide-react"
import Image from "next/image"
import logo from '@/assets/Logo_.png'
import { useState } from "react"

const navItems = [
  {
    label: "Upload Data",
    href: "/dashboard",
    icon: Upload,
    description: "Process new files",
  },
  {
    label: "My Uploads",
    href: "/dashboard/uploads",
    icon: FolderOpen,
    description: "View history",
  },
]

export function DashboardSidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Mobile menu button */}
      <div className="fixed top-4 left-4 z-50 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(!isOpen)}
          className="h-8 w-8"
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 flex h-screen w-64 sm:w-72 lg:w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-300 md:relative md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 h-14 sm:h-16 border-b border-sidebar-border">
          <div className="flex h-8 sm:h-9 w-8 sm:w-9 items-center justify-center rounded-lg sm:rounded-xl bg-primary/20 ring-1 ring-primary/30 shrink-0">
            <Image src={logo} alt="" className="h-5 sm:h-6 w-5 sm:w-6" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs sm:text-sm font-semibold text-sidebar-foreground tracking-tight truncate">OPTIGAIN</span>
            <span className="text-[8px] sm:text-[10px] text-sidebar-foreground/40 uppercase tracking-widest font-medium hidden sm:block">Enterprise</span>
          </div>
        </div>

        {/* Nav section label */}
        <div className="px-3 sm:px-5 pt-4 sm:pt-6 pb-2">
          <span className="text-[8px] sm:text-[10px] uppercase tracking-widest font-semibold text-sidebar-foreground/30">Navigation</span>
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col gap-1 px-2 sm:px-3">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  "group flex items-center gap-2 sm:gap-3 rounded-lg px-2 sm:px-3 py-2 sm:py-2.5 text-xs sm:text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-border"
                    : "text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <div className={cn(
                  "flex h-7 sm:h-8 w-7 sm:w-8 items-center justify-center rounded-lg transition-colors shrink-0",
                  isActive ? "bg-primary/20 text-primary" : "bg-sidebar-border/50 text-sidebar-foreground/40 group-hover:text-sidebar-foreground/70"
                )}>
                  <item.icon className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate">{item.label}</span>
                  <span className={cn(
                    "text-[8px] sm:text-[10px] truncate",
                    isActive ? "text-sidebar-foreground/50" : "text-sidebar-foreground/30"
                  )}>{item.description}</span>
                </div>
                {isActive && <ChevronRight className="h-3 sm:h-3.5 w-3 sm:w-3.5 text-sidebar-foreground/30 shrink-0" />}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="border-t border-sidebar-border p-2 sm:p-3">
          <form action={logout}>
            <Button
              type="submit"
              variant="ghost"
              className="w-full justify-start gap-2 sm:gap-3 h-8 sm:h-10 rounded-lg text-xs sm:text-sm text-sidebar-foreground/40 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-all"
            >
              <LogOut className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sm:hidden">Logout</span>
            </Button>
          </form>
        </div>
      </aside>
    </>
  )
}
