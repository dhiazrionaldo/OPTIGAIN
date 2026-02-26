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
  base_price: number
  base_cost: number
}

interface SimulationResult {
  projected_quantity: number
  projected_revenue: number
  projected_profit: number
  delta_revenue: number
  delta_profit: number
  delta_revenue_percent: number
  delta_profit_percent: number
}

interface SimulationFormProps {
  onSimulationComplete: (result: SimulationResult) => void
}

export function SimulationForm({ onSimulationComplete }: SimulationFormProps) {
  const [skus, setSkus] = useState<SKU[]>([])
  const [selectedSku, setSelectedSku] = useState("")
  const [baseSku, setBaseSku] = useState<SKU | null>(null)
  const [loading, setLoading] = useState(false)
  const [isLoadingSkus, setIsLoadingSkus] = useState(true)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  )

  const [formData, setFormData] = useState({
    scenario_name: "",
    new_price: "",
    new_cost: "",
  })

  // Fetch SKUs on mount
  useEffect(() => {
    const fetchSkus = async () => {
      try {
        const response = await fetch("/api/skus")
        if (response.ok) {
          const data = await response.json()
          setSkus(data)
          if (data.length > 0) {
            setSelectedSku(data[0].id)
            setBaseSku(data[0])
          }
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

  // Update base SKU when selection changes
  useEffect(() => {
    const sku = skus.find((s) => s.id === selectedSku)
    setBaseSku(sku || null)
    // Auto-populate fields with current prices
    if (sku) {
      setFormData((prev) => ({
        ...prev,
        new_price: sku.base_price.toString(),
        new_cost: sku.base_cost.toString(),
      }))
    }
  }, [selectedSku, skus])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch("/api/revenue/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_id: selectedSku,
          new_price: parseFloat(formData.new_price),
          new_cost: parseFloat(formData.new_cost),
          scenario_name: formData.scenario_name,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setMessage({
          type: "success",
          text: `Simulation created: ${result.scenario_name}`,
        })
        onSimulationComplete({
          projected_quantity: result.projected_quantity,
          projected_revenue: result.projected_revenue,
          projected_profit: result.projected_profit,
          delta_revenue: result.delta_revenue,
          delta_profit: result.delta_profit,
          delta_revenue_percent: result.delta_revenue_percent,
          delta_profit_percent: result.delta_profit_percent,
        })
        setFormData({ scenario_name: "", new_price: "", new_cost: "" })
      } else {
        setMessage({ type: "error", text: result.error || "Failed to run simulation" })
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
      <h2 className="text-lg font-semibold mb-4">Create Simulation</h2>

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
          {baseSku && (
            <p className="text-xs text-muted-foreground">
              Current Price: ${baseSku.base_price?.toFixed(2) || "0.00"} | Cost: ${baseSku.base_cost?.toFixed(2) || "0.00"}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="scenario">Scenario Name</Label>
          <Input
            id="scenario"
            type="text"
            placeholder="e.g., 'Price increase 10%'"
            value={formData.scenario_name}
            onChange={(e) =>
              setFormData({ ...formData, scenario_name: e.target.value })
            }
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="new-price">New Price</Label>
            <Input
              id="new-price"
              type="number"
              step="0.01"
              min="0"
              value={formData.new_price}
              onChange={(e) =>
                setFormData({ ...formData, new_price: e.target.value })
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-cost">New Cost</Label>
            <Input
              id="new-cost"
              type="number"
              step="0.01"
              min="0"
              value={formData.new_cost}
              onChange={(e) =>
                setFormData({ ...formData, new_cost: e.target.value })
              }
              required
            />
          </div>
        </div>

        <Button type="submit" disabled={loading || !selectedSku} className="w-full">
          {loading ? <Spinner className="mr-2" /> : null}
          {loading ? "Running Simulation..." : "Run Simulation"}
        </Button>
      </form>
    </Card>
  )
}
