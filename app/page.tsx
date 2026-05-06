import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    // send authenticated users directly to new upload page by default
    redirect("/dashboard/new_upload")
  } else {
    redirect("/login")
  }
}
