"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { deleteFailedUploadAction } from "@/app/dashboard/actions"
import { useRouter } from "next/navigation"

interface FailedUploadErrorProps {
  uploadId: string
}

export function FailedUploadError({ uploadId }: FailedUploadErrorProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const router = useRouter()

  async function handleDelete() {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const result = await deleteFailedUploadAction(uploadId)
      if (result.error) {
        setDeleteError(result.error)
        setIsDeleting(false)
      } else {

        console.log('upload result: ', result)
        // Redirect back to uploads list after successful deletion
        router.push("/dashboard/uploads")
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unknown error")
      setIsDeleting(false)
    }
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 ring-1 ring-destructive/20">
          <span className="text-lg font-bold text-destructive">!</span>
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-foreground">Error on AI Prediction</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            The AI prediction service failed or timed out. The data will be automatically cleaned up.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDelete}
          disabled={isDeleting}
        >
          {isDeleting ? "Cleaning up..." : "Clean up and Return"}
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/uploads">
            Cancel
          </Link>
        </Button>
      </div>
      {deleteError && (
        <p className="text-xs text-destructive mt-2">{deleteError}</p>
      )}
    </div>
  )
}
