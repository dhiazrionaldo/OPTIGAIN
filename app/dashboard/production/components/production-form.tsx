"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { AlertCircle, CheckCircle } from "lucide-react"

interface SKU {
  id: string
  sku_code: string
  product_name: string
  category: string
  base_price: number
  base_cost: number
}

export function ProductionForm() {
  const [skus, setSkus] = useState<SKU[]>([])
  const [selectedSku, setSelectedSku] = useState("")
  const [loading, setLoading] = useState(false)
  const [isLoadingSkus, setIsLoadingSkus] = useState(true)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  )

  const [formData, setFormData] = useState({
    production_date: "",
    quantity: "",
    production_cost: "",
  })

  // Fetch SKUs on mount
  useEffect(() => {
    const fetchSkus = async () => {
      try {
        const response = await fetch("/api/skus")
        if (response.ok) {
          const data = await response.json()
          setSkus(data)
        }
      } catch (error) {
        console.error("Failed to fetch SKUs:", error)
        setMessage({ type: "error", text: "Failed to load SKUs" })
      } finally {
        setIsLoadingSkus(false)
      }
    }

    fetchSkus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch("/api/production/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_id: selectedSku,
          production_date: formData.production_date,
          quantity: parseInt(formData.quantity),
          production_cost: parseFloat(formData.production_cost),
        }),
      })

      const result = await response.json()

      if (result.success) {
        setMessage({ type: "success", text: "Production record added successfully" })
        setFormData({ production_date: "", quantity: "", production_cost: "" })
        setSelectedSku("")
      } else {
        setMessage({ type: "error", text: result.error || "Failed to add record" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "An error occurred. Please try again." })
    } finally {
      setLoading(false)
    }
  }

  if (isLoadingSkus) {
    return <div className="flex justify-center"><Spinner /></div>
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-4">Add Production Record</h2>

      {message && (
        <Alert
          variant={message.type === "error" ? "destructive" : "default"}
          className="mb-4"
        >
          {message.type === "error" ? (
            <AlertCircle className="h-4 w-4 mr-2 inline" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2 inline" />
          )}
          {message.text}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sku">SKU</Label>
          <Select value={selectedSku} onValueChange={setSelectedSku}>
            <SelectTrigger id="sku">
              <SelectValue placeholder="Select a SKU" />
            </SelectTrigger>
            <SelectContent>
              {skus.map((sku) => (
                <SelectItem key={sku.id} value={sku.id}>
                  {sku.sku_code} - {sku.product_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="date">Production Date</Label>
          <Input
            id="date"
            type="date"
            value={formData.production_date}
            onChange={(e) =>
              setFormData({ ...formData, production_date: e.target.value })
            }
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            type="number"
            min="1"
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cost">Production Cost</Label>
          <Input
            id="cost"
            type="number"
            step="0.01"
            min="0"
            value={formData.production_cost}
            onChange={(e) =>
              setFormData({ ...formData, production_cost: e.target.value })
            }
            required
          />
        </div>

        <Button type="submit" disabled={loading || !selectedSku} className="w-full">
          {loading ? <Spinner className="mr-2" /> : null}
          {loading ? "Adding..." : "Add Production Record"}
        </Button>
      </form>
    </Card>
  )
}
