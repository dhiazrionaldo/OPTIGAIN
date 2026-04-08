"use client"

import Link from "next/link"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Eye, FileSpreadsheet, ArrowRight, FolderOpen } from "lucide-react"

interface Upload {
  id: string
  file_name: string
  uploaded_at: string
  row_count: number
  sheet_month?: number | null
  sheet_year?: number | null
}

export function UploadsTable({ uploads }: { uploads: Upload[] }) {
  if (uploads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 px-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary ring-1 ring-border">
          <FolderOpen className="h-7 w-7 text-muted-foreground/40" />
        </div>
        <h3 className="mt-5 text-base font-semibold text-foreground">No uploads yet</h3>
        <p className="mt-1.5 text-sm text-muted-foreground text-center max-w-xs">
          Upload your first Excel file to begin analyzing gross profit data.
        </p>
        <Button asChild className="mt-6 h-10 bg-primary hover:bg-primary/90 text-primary-foreground">
          <Link href="/dashboard/new_upload">
            Upload Data
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Upload History</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{uploads.length} file{uploads.length !== 1 ? "s" : ""} uploaded</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60 h-10">File</TableHead>
            <TableHead className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60 h-10">Month</TableHead>
            <TableHead className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60 h-10">Rows</TableHead>
            <TableHead className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60 h-10">Uploaded</TableHead>
            <TableHead className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60 h-10 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {uploads.map((upload) => (
            <TableRow key={upload.id} className="border-border group hover:bg-secondary/40 transition-colors">
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{upload.file_name}</span>
                </div>
              </TableCell>
              <TableCell>
                {upload.sheet_month && upload.sheet_year ? (
                  <Badge variant="secondary" className="text-xs font-mono bg-secondary text-secondary-foreground ring-1 ring-border">
                    {new Date(upload.sheet_year, upload.sheet_month - 1).toLocaleString("default", { month: "short", year: "numeric" })}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">–</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-xs font-mono bg-secondary text-secondary-foreground ring-1 ring-border">
                  {upload.row_count}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(upload.uploaded_at), "MMM d, yyyy 'at' HH:mm")}
              </TableCell>
              <TableCell className="text-right">
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Link href={`/dashboard/uploads/${upload.id}`}>
                      <Eye className="h-3.5 w-3.5" />
                      View
                      <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  )
}
