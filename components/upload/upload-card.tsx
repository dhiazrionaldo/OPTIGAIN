"use client"

import { useState, useTransition, useRef } from "react"
import { uploadExcelAction } from "@/app/dashboard/actions"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Upload, FileSpreadsheet, AlertCircle, X, CheckCircle2, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export function UploadCard() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [progress, setProgress] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    setError(null)
    if (selected) {
      if (!selected.name.endsWith(".xlsx") && !selected.name.endsWith(".xls")) {
        setError("Please upload a valid Excel file (.xlsx or .xls)")
        setFile(null)
        return
      }
      setFile(selected)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    setError(null)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) {
      if (!dropped.name.endsWith(".xlsx") && !dropped.name.endsWith(".xls")) {
        setError("Please upload a valid Excel file (.xlsx or .xls)")
        return
      }
      setFile(dropped)
    }
  }

  function handleSubmit() {
    if (!file) return

    setProgress(10)
    const formData = new FormData()
    formData.append("file", file)

    startTransition(async () => {
      setProgress(30)
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 10, 90))
      }, 500)

      const result = await uploadExcelAction(formData)

      clearInterval(progressInterval)
      setProgress(100)

      if (result?.error) {
        setError(result.error)
        setProgress(0)
        toast.error("Upload failed", { description: result.error })
      } else {
        toast.success("Upload complete", {
          description: "Your file has been processed and sent for AI analysis.",
        })
      }
    })
  }

  function clearFile() {
    setFile(null)
    setError(null)
    setProgress(0)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4 md:gap-5 rounded-lg sm:rounded-xl border border-border bg-card p-3 sm:p-4 md:p-6">
      {/* Section header */}
      <div className="flex items-start gap-2 sm:gap-3">
        <div className="flex h-8 sm:h-9 w-8 sm:w-9 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 shrink-0 mt-0.5 sm:mt-0">
          <Upload className="h-3.5 sm:h-4 w-3.5 sm:w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-semibold text-foreground tracking-tight">Upload Gross Profit Excel</h2>
          <p className="text-[10px] sm:text-xs text-muted-foreground leading-relaxed">Standard template with Customer, KOG, Qty, Sales, Freight, COGS, GM columns</p>
        </div>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 sm:gap-3 md:gap-4 rounded-lg sm:rounded-xl border-2 border-dashed p-4 sm:p-6 md:p-10 transition-all duration-200",
          isDragOver
            ? "border-primary bg-primary/5 shadow-inner"
            : file
              ? "border-accent/40 bg-accent/5"
              : "border-border hover:border-muted-foreground/30 hover:bg-secondary/50"
        )}
      >
        {file ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 md:gap-4 w-full">
            <div className="flex h-10 sm:h-12 w-10 sm:w-12 items-center justify-center rounded-lg sm:rounded-xl bg-accent/10 ring-1 ring-accent/20 shrink-0">
              <FileSpreadsheet className="h-5 sm:h-6 w-5 sm:w-6 text-accent" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <p className="text-xs sm:text-sm font-medium text-foreground truncate">{file.name}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB · Ready to process
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearFile}
              disabled={isPending}
              className="h-7 sm:h-8 w-7 sm:w-8 rounded-lg text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex h-10 sm:h-12 md:h-14 w-10 sm:w-12 md:w-14 items-center justify-center rounded-lg sm:rounded-xl md:rounded-2xl bg-secondary ring-1 ring-border">
              <Upload className="h-5 sm:h-6 md:h-6 w-5 sm:w-6 md:w-6 text-muted-foreground/50" />
            </div>
            <div className="text-center">
              <p className="text-xs sm:text-sm font-medium text-foreground">
                Drop your Excel file here
              </p>
              <p className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-muted-foreground">
                or{" "}
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  browse to choose
                </label>
                {" "}· .xlsx, .xls
              </p>
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          id="file-upload"
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          className="sr-only"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 sm:gap-2.5 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 sm:px-4 py-2 sm:py-3 text-[10px] sm:text-sm text-destructive">
          <AlertCircle className="h-3.5 sm:h-4 w-3.5 sm:w-4 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* Progress */}
      {isPending && (
        <div className="flex flex-col gap-2 sm:gap-2.5">
          <div className="flex items-center justify-between text-[10px] sm:text-xs">
            <span className="text-muted-foreground font-medium">Processing file...</span>
            <span className="text-foreground font-mono">{progress}%</span>
          </div>
          <Progress value={progress} className="h-1 sm:h-1.5" />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <Button
          onClick={handleSubmit}
          disabled={!file || isPending}
          className="h-8 sm:h-9 md:h-10 px-3 sm:px-4 md:px-6 text-xs sm:text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all w-full sm:w-auto"
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-1 sm:gap-2">
              <span>Processing...</span>
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1 sm:gap-2">
              <span className="hidden sm:inline">Upload & Process</span>
              <span className="sm:hidden">Upload</span>
              <ArrowRight className="h-3 sm:h-4 w-3 sm:w-4" />
            </span>
          )}
        </Button>
        {progress === 100 && !error && (
          <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-accent font-medium">
            <CheckCircle2 className="h-3.5 sm:h-4 w-3.5 sm:w-4 shrink-0" />
            <span className="hidden sm:inline">Processed successfully</span>
            <span className="sm:hidden">Done</span>
          </div>
        )}
      </div>
    </div>
  )
}
