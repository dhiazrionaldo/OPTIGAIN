"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, ArrowRight, Save, Trash2,  Check, ChevronsUpDown, Search, Pencil } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

// ── Types ────────────────────────────────────────────────────────────────────
interface ProductMaster {
  id: string
  family: string
  product_name: string
  is_pareto: boolean
}

export default function ProductMappingDashboard() {

  // ── Form state ─────────────────────────────────────────────────────────────
  const [product_name,      setProduct_name]      = useState("")
  const [family,    setFamily]    = useState("")
  const [is_pareto, setIs_pareto] = useState(false)
  const [subProductId,    setSubProductId]    = useState("")
  const [searchProduct, setSearchProduct] = useState("")

  // ── UI state ───────────────────────────────────────────────────────────────
  const [mappings,  setMappings]  = useState<ProductMaster[]>([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ product_name?: string; family?: string; is_pareto?: boolean }>({})

  // ── Search Customer ────────────────────────────────────────────────────────
  const filteredMappings = mappings.filter(m =>
    m.product_name?.toLowerCase().includes(searchProduct.toLowerCase())
  )
  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetchMappings(),
    ]).finally(() => setLoading(false))
  }, [])

 
  // ── Fetchers ───────────────────────────────────────────────────────────────
  async function fetchMappings() {
    const res  = await fetch("/api/product-master")
    const data = await res.json()
    
    if (!res.ok) {
      console.error("Mappings API error:", data)
      setMappings([])
      return
    }

    setMappings(Array.isArray(data) ? data : [])
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  // ── Create (form submit) ───────────────────────────────────────────────────
async function handleCreate(e: React.FormEvent) {
  e.preventDefault()
  setError(null)
  setSuccess(null)

  if (!product_name) return setError("Please enter a product name")
  if (!family)       return setError("Please enter a family")

  try {
    setSaving(true)
    const res = await fetch("/api/product-master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_name, family, is_pareto }),
    })

    const result = await res.json()
    if (!res.ok) { setError(result.error || "Failed to save Product"); return }

    setSuccess("Product saved successfully!")
    setProduct_name(""); setFamily(""); setIs_pareto(false)
    await fetchMappings()
  } catch {
    setError("Failed to save Product")
    toast.error("Failed to save Product")
  } finally {
    setSaving(false)
    toast.success("Product saved successfully!")
  }
}

// ── Update (inline edit) ───────────────────────────────────────────────────
async function handleUpdate(id: string) {
  setError(null)

  if (!editForm.product_name) return setError("Product name is required")
  if (!editForm.family)       return setError("Family is required")

  try {
    setSaving(true)
    const res = await fetch("/api/product-master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        product_name: editForm.product_name,
        family: editForm.family,
        is_pareto: editForm.is_pareto ?? false,
      }),
    })

    const result = await res.json()
    if (!res.ok) { setError(result.error || "Failed to update Product"); return }

    setEditingId(null)
    await fetchMappings()
  } catch {
    setError("Failed to update Product")
    toast.error("Failed to update Product")
  } finally {
    setSaving(false)
    toast.success("Product updated successfully!")
  }
}
  // async function handleSave(e: React.FormEvent) {
  //   e.preventDefault()
  //   setError(null)
  //   setSuccess(null)
  //   setEditingId(null)

  //   if (!product_name)      return setError("Please select a customer")
  //   if (!family) return setError("Please select the original product")
  //   if (!is_pareto)    return setError("Please select the substitution product")
  //   try {
  //     setSaving(true)
  //     const res = await fetch("/api/product-master", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({
  //         id,
  //         product_name: product_name,
  //         family: family,
  //         is_pareto: is_pareto
  //       }),
  //     })

  //     const result = await res.json()
  //     if (!res.ok) {
  //       setError(result.error || "Failed to save Product")
  //       return
  //     }

  //     setSuccess("Product saved successfully!")
  //     // Reset form
  //     setProduct_name(""); setFamily(""); setIs_pareto(false)
  //     await fetchMappings()
  //   } catch {
  //     setError("Failed to save Product")
  //   } finally {
  //     setSaving(false)
  //   }
  // }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/product-master?id=${id}`, { method: "DELETE" })
      if (!res.ok) { setError("Failed to delete product"); return }
      setMappings(prev => prev.filter(m => m.id !== id))
    } catch {
      setError("Failed to delete product")
      toast.error("Failed to delete product")
    }finally {
      toast.success("Product deleted successfully!")
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="space-y-8 p-8"><Skeleton className="h-96 w-full bg-secondary" /></div>
  }

  return (
    <div className="space-y-8 p-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold">Product Master</h1>
        <p className="mt-2 text-gray-600">Manage product information</p>
      </div>

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="border-green-500 text-green-700">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Form Card ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Add New Product</CardTitle>
            <CardDescription>Create a new product entry in the master list</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="product_name">Product Name</Label>
                  <Input
                    id="product_name"
                    placeholder="Enter product name"
                    value={product_name}
                    onChange={(e) => setProduct_name(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="family">Family</Label>
                  <Input
                    id="family"
                    placeholder="Enter family"
                    value={family}
                    onChange={(e) => setFamily(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="is_pareto">Is Pareto?</Label>
                  <Switch
                    id="is_pareto"
                    checked={is_pareto}
                    onCheckedChange={setIs_pareto}
                  />
                </div>

              <Button type="submit" disabled={saving} className="w-full">
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save Products"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Mappings List ────────────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Saved Products</CardTitle>
            <CardDescription>{filteredMappings.length} of {mappings.length} products(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by product name..."
                value={searchProduct}
                onChange={(e) => setSearchProduct(e.target.value)}
                className="pl-8"
              />
            </div>

            {/* List */}
            {filteredMappings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {mappings.length === 0
                  ? "No data yet. Create one using the form on the left."
                  : "No data found for that product."}
              </div>
            ) : (
              <ScrollArea className="h-[460px] pr-3">
                <div className="space-y-3">
                  {filteredMappings.map(m => {
                    const isEditing = editingId === m.id
                    return (
                      <div key={m.id} className={`rounded-lg border bg-card transition-all ${isEditing ? 'border-primary/40 shadow-md' : 'hover:bg-muted/30'}`}>
                        
                        {/* Header */}
                        <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-border/50">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold bg-secondary text-secondary-foreground px-2 py-0.5 rounded">
                              {isEditing ? (editForm.family || "—") : (m.family ?? "—")}
                            </span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              (isEditing ? editForm.is_pareto : m.is_pareto)
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-primary/10 text-primary'
                            }`}>
                              {(isEditing ? editForm.is_pareto : m.is_pareto) ? "Pareto" : "Non-Pareto"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {isEditing ? (
                              <>
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setEditingId(null)}>
                                  Cancel
                                </Button>
                                <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleUpdate(m.id)}>
                                  Save
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingId(m.id); setEditForm({ product_name: m.product_name, family: m.family, is_pareto: m.is_pareto }) }}>
                                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDelete(m.id)}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Body */}
                        <div className="px-3 py-2.5 space-y-2">
                          {isEditing ? (
                            <>
                              <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Product Name</label>
                                <Input
                                  className="h-8 text-xs"
                                  value={editForm.product_name ?? ""}
                                  onChange={e => setEditForm(f => ({ ...f, product_name: e.target.value }))}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Family</label>
                                <Input
                                  className="h-8 text-xs"
                                  value={editForm.family ?? ""}
                                  onChange={e => setEditForm(f => ({ ...f, family: e.target.value }))}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Type</label>
                                <Select value={editForm.is_pareto ? "pareto" : "non-pareto"} onValueChange={v => setEditForm(f => ({ ...f, is_pareto: v === "pareto" }))}>
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pareto" className="text-xs">Pareto</SelectItem>
                                    <SelectItem value="non-pareto" className="text-xs">Non-Pareto</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] text-muted-foreground w-20 shrink-0 mt-0.5">Product</span>
                                <span className="text-xs font-semibold leading-tight">{m.product_name ?? "—"}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground w-20 shrink-0">Family</span>
                                <span className="text-xs font-semibold">{m.family ?? "—"}</span>
                              </div>
                            </>
                          )}
                        </div>

                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
              // <ScrollArea className="h-[460px] pr-3">
              //   <div className="space-y-3">
              //     {filteredMappings.map(m => (
              //       <div key={m.id} className="rounded-lg border bg-card p-3 hover:bg-muted/30 transition-colors">
                      
              //         {/* Top row */}
              //         <div className="flex items-center justify-between mb-2">
              //           <div className="flex items-center gap-2">
              //             <span className="text-xs font-medium bg-secondary text-secondary-foreground px-2 py-0.5 rounded">
              //               {m.family ?? "—"}
              //             </span>
              //             <span className="text-xs bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full">
              //               {m.is_pareto ? "Pareto" : "Non-Pareto"}
              //             </span>
              //           </div>
              //           <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)}>
              //             <Trash2 className="h-4 w-4 text-destructive" />
              //           </Button>
              //         </div>

              //         {/* Bottom row */}
              //         <div className="flex items-center gap-2">
              //           <div className="flex-1 rounded-md bg-muted px-3 py-2 min-w-0 gap-2 flex flex-col">
              //             <p className="text-[10px] text-muted-foreground mb-0.5">Details</p>
              //             <p className="text-xs font-semibold truncate">Product Name : {m.product_name ?? "—"}</p>
              //             <p className="text-xs font-semibold truncate">Family : {m.family ?? "—"}</p>
              //             <p className="text-xs bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full max-w-[90px] text-center">{m.is_pareto ? "Pareto" : "Non-Pareto"}</p>
              //           </div>
              //         </div>

              //       </div>
              //     ))}
              //   </div>
              // </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}