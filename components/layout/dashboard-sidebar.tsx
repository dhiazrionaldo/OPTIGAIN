"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { logout } from "@/app/(auth)/actions"
import { cn } from "@/lib/utils"
import { Upload, FolderOpen, LogOut, TrendingUp, ChevronRight, GitBranchIcon, GitCommit } from "lucide-react"
import Image from "next/image"
import logo from '@/assets/Logo_.png'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

const navItems = [
  {
    label: "Upload Data",
    href: "/dashboard/new_upload",
    icon: Upload,
    description: "Process new files",
  },
  {
    label: "My Uploads",
    href: "/dashboard/uploads",
    icon: FolderOpen,
    description: "View history",
  },
  {
    label: "Product Mapping",
    href: "/dashboard/product_mappings",
    icon: GitBranchIcon,
    description: "Product mix mapping",
  },
  {
    label: "Product Master",
    href: "/dashboard/product_master",
    icon: GitCommit,
    description: "Manage product information",
  }
]

export function DashboardSidebar() {
  const pathname = usePathname()
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

  return (
    <Sidebar variant="floating" collapsible="icon" className="border-sidebar-border">

      {/* Logo Section */}
      <SidebarHeader className="border-b border-sidebar-border h-16 justify-center px-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-transparent">
              <Link
                href="/dashboard/new_upload"
                className={cn(
                  "flex items-center w-full",
                  isCollapsed ? "justify-center" : "gap-3"
                )}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm shrink-0">
                  <Image src={logo} alt="Optigain" className="h-6 w-6" />
                </div>
                {!isCollapsed && (
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold text-sidebar-foreground tracking-tight leading-none">
                      BISA
                    </span>
                    <div className="grid grid-cols-[auto_auto] mt-1 gap-y-0.5 gap-x-1 w-fit">
                      {[["B","erani"], ["I","novatif"], ["S","inergi"], ["A","daptif"]].map(([bold, rest]) => (
                        <p key={bold} className="text-[10px] text-sidebar-foreground/70 italic leading-none">
                          <b className="text-white">{bold}</b>{rest}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Nav Items */}
      <SidebarContent>
        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest font-bold text-sidebar-foreground/50 pt-6 pb-2 px-4">
              Navigation
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={cn("gap-1.5", isCollapsed ? "px-0 items-center" : "px-3")}>
              {navItems.map((item) => {
                const isActive = pathname.startsWith(item.href)

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className={cn(
                        "h-11 transition-all duration-200 rounded-xl",
                        isCollapsed && "!size-11 justify-center",
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg ring-1 ring-sidebar-primary/20"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center w-full",
                          isCollapsed ? "justify-center" : "gap-3"
                        )}
                      >
                        <div className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                          isActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "bg-white/10 text-sidebar-foreground"
                        )}>
                          <item.icon className="h-4 w-4" />
                        </div>

                        {!isCollapsed && (
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="truncate font-bold text-xs">{item.label}</span>
                            <span className="text-[9px] truncate opacity-60 font-medium">
                              {item.description}
                            </span>
                          </div>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Logout */}
      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Sign out"
              className={cn(
                "h-10 rounded-xl text-sidebar-foreground/80 hover:bg-destructive/20 hover:text-white transition-colors",
                isCollapsed && "!size-11 justify-center"
              )}
            >
              <form action={logout}>
                <button
                  type="submit"
                  className={cn(
                    "flex items-center w-full",
                    isCollapsed ? "justify-center" : "gap-3"
                  )}
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  {!isCollapsed && (
                    <span className="font-semibold text-xs">Sign out</span>
                  )}
                </button>
              </form>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

    </Sidebar>
  )
}