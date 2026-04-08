"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts"
import { AlertCircle, Trash2, Play, ArrowRight, Save } from "lucide-react"
import type { RevenueForecast, RevenueSimulation } from "@/lib/database.types"

export default function SimulationDashboard() {
  const supabase = createClient()

  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [simulating, setSimulating] = useState(false)

  const [scenarioName, setScenarioName] = useState("")
  const [adjustmentType, setAdjustmentType] = useState("price")
  const [adjustmentValue, setAdjustmentValue] = useState("0")

  const [baseline, setBaseline] = useState<RevenueForecast | null>(null)
  const [simulations, setSimulations] = useState<RevenueSimulation[]>([])
  const [selectedSimulation, setSelectedSimulation] = useState<RevenueSimulation | null>(null)

  // Load baseline forecast and existing simulations
  useEffect(() => {
    setMounted(true)
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      setError(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch baseline company forecast
      const { data: forecastData } = await supabase
        .from("revenue_forecasts")
        .select("*")
        .eq("user_id", user.id)
        .eq("level", "company")
        .order("created_at", { ascending: false })
        .limit(1)

      if (forecastData && forecastData.length > 0) {
        setBaseline(forecastData[0])
      }

      // Fetch simulations
      const { data: simulationData } = await supabase
        .from("revenue_simulations")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })

      setSimulations(simulationData || [])
    } catch (err) {
      console.error("Error loading data:", err)
      setError("Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  async function handleRunSimulation(e: React.FormEvent) {
    e.preventDefault()

    if (!scenarioName.trim()) {
      setError("Please enter a scenario name")
      return
    }

    if (!baseline) {
      setError("No baseline forecast available. Please run forecasting first.")
      return
    }

    try {
      setSimulating(true)
      setError(null)

      const response = await fetch("/api/revenue/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario_name: scenarioName.trim(),
          adjustment_type: adjustmentType,
          adjustment_value: parseFloat(adjustmentValue),
        }),
      })

      const result = await response.json()

      if (!result.success) {
        setError(result.error || "Simulation failed")
        return
      }

      // Reset form
      setScenarioName("")
      setAdjustmentValue("0")

      // Reload simulations
      await loadData()
    } catch (err) {
      setError("Failed to run simulation")
      console.error(err)
    } finally {
      setSimulating(false)
    }
  }

  async function handleDeleteSimulation(id: string) {
    try {
      const response = await fetch(`/api/revenue/simulate?id=${id}`, { method: "DELETE" })
      const result = await response.json()

      if (!result.success) {
        setError(result.error || "Failed to delete simulation")
        return
      }

      setSimulations(simulations.filter(s => s.id !== id))
      if (selectedSimulation?.id === id) {
        setSelectedSimulation(null)
      }
    } catch (err) {
      setError("Failed to delete simulation")
      console.error(err)
    }
  }

  // Prepare comparison data
  const comparisonData = baseline && selectedSimulation
    ? [
        {
          scenario: "Baseline",
          revenue: baseline.predicted_revenue,
          margin: baseline.predicted_margin,
        },
        {
          scenario: selectedSimulation.scenario_name,
          revenue: selectedSimulation.projected_revenue,
          margin: selectedSimulation.projected_margin,
        },
      ]
    : []

  const revenueDifference = selectedSimulation && baseline
    ? selectedSimulation.projected_revenue - baseline.predicted_revenue
    : 0
  const marginDifference = selectedSimulation && baseline
    ? selectedSimulation.projected_margin - baseline.predicted_margin
    : 0

  if (!mounted || loading) {
    return <div className="space-y-8 p-8"><Skeleton className="h-96 w-full bg-secondary" /></div>
  }

  return (
    <div className="space-y-8 p-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold">Product Mapping</h1>
        <p className="mt-2 text-gray-600">Set the product switch mapping for AI reference</p>
      </div>

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!baseline && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No Mapping available. Please insert the product mapping data first.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Scenario Builder Form */}
        <Card>
          <CardHeader>
            <CardTitle>Product Mapping</CardTitle>
            <CardDescription>Set the product switch mapping for AI reference</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRunSimulation} className="space-y-4">
              <div>
                <Label htmlFor="scenario">Customer Name</Label>
                <Input
                  id="scenario"
                  placeholder="e.g., 10% Price Increase"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  disabled={simulating}
                />
              </div>
              {/* BUNGKUS UTAMA HARUS RELATIVE */}
              <div className="relative">
                
                {/* GRID 2 KOLOM MURNI (Tanpa elemen panah di dalamnya) */}
                {/* Saya ubah gap-4 jadi gap-x-8 agar ada ruang bernapas untuk panah di tengah */}
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  
                  {/* --- KOLOM KIRI --- */}
                  <div className="space-y-4">
                    <div>
                      <Label>Product Family</Label>
                      <Select value={adjustmentType} onValueChange={setAdjustmentType} disabled={simulating}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="price">DG</SelectItem>
                          <SelectItem value="cost">FL</SelectItem>
                          <SelectItem value="volume">1L</SelectItem>
                          <SelectItem value="mixed">FK</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Original Product</Label>
                      <Select value={adjustmentType} onValueChange={setAdjustmentType} disabled={simulating}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="price">DG 1 MM</SelectItem>
                          <SelectItem value="cost">DG 3 MM</SelectItem>
                          <SelectItem value="volume">DG 5 MM</SelectItem>
                          <SelectItem value="mixed">DG 10 MM</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  {/* --- KOLOM KANAN --- */}
                  <div className="space-y-4">
                    <div>
                      <Label>Product Family</Label>
                      <Select value={adjustmentType} onValueChange={setAdjustmentType} disabled={simulating}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="price">DG</SelectItem>
                          <SelectItem value="cost">FL</SelectItem>
                          <SelectItem value="volume">1L</SelectItem>
                          <SelectItem value="mixed">FK</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Substitution Product</Label>
                      <Select value={adjustmentType} onValueChange={setAdjustmentType} disabled={simulating}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="price">DG 1 MM</SelectItem>
                          <SelectItem value="cost">DG 3 MM</SelectItem>
                          <SelectItem value="volume">DG 5 MM</SelectItem>
                          <SelectItem value="mixed">DG 10 MM</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                </div>

                {/* --- PANAH DI DEAD CENTER --- */}
                <div className="absolute top-1/3 left-1/3 -translate-x-1/3 -translate-y-1/3 flex items-center justify-center pointer-events-none bg-card p-1 rounded-full">
                  <ArrowRight className="h-10 w-10 text-muted-foreground/100" />
                </div>
                
              </div>
              {/* <div className="grid grid-cols-2 gap-4 items-end">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="adjustment">Product Family</Label>
                    <Select value={adjustmentType} onValueChange={setAdjustmentType} disabled={simulating}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="price">DG</SelectItem>
                        <SelectItem value="cost">FL</SelectItem>
                        <SelectItem value="volume">1L</SelectItem>
                        <SelectItem value="mixed">FK</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="adjustment">Original Product</Label>
                    <Select value={adjustmentType} onValueChange={setAdjustmentType} disabled={simulating}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="price">DG 1 MM</SelectItem>
                        <SelectItem value="cost">DG 3 MM</SelectItem>
                        <SelectItem value="volume">DG 5 MM</SelectItem>
                        <SelectItem value="mixed">DG 10 MM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="relative left-1/2 -translate-x-1/2 flex items-end pb-2">
                  <ArrowRight className="w-6 h-6 text-muted-foreground" />
                </div>
                
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="adjustment">Product Family</Label>
                    <Select value={adjustmentType} onValueChange={setAdjustmentType} disabled={simulating}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="price">DG</SelectItem>
                        <SelectItem value="cost">FL</SelectItem>
                        <SelectItem value="volume">1L</SelectItem>
                        <SelectItem value="mixed">FK</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="adjustment">Substitution Product</Label>
                    <Select value={adjustmentType} onValueChange={setAdjustmentType} disabled={simulating}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="price">DG 1 MM</SelectItem>
                        <SelectItem value="cost">DG 3 MM</SelectItem>
                        <SelectItem value="volume">DG 5 MM</SelectItem>
                        <SelectItem value="mixed">DG 10 MM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div> */}
              

              

              <Button type="submit" disabled={simulating || !baseline} className="w-full">
                {simulating ? "Running..." : <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Simulations List */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Simulations</CardTitle>
            <CardDescription>{simulations.length} scenario(s)</CardDescription>
          </CardHeader>
          <CardContent>
            {simulations.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No simulations yet. Create one using the form on the left.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {simulations.map((sim) => (
                  <div
                    key={sim.id}
                    onClick={() => setSelectedSimulation(sim)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedSimulation?.id === sim.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{sim.scenario_name}</p>
                        <p className="text-xs text-gray-600">
                          {sim.adjustment_type}: {sim.adjustment_value > 0 ? "+" : ""}{sim.adjustment_value}%
                        </p>
                        <p className="text-sm font-semibold mt-1">
                          ${sim.projected_revenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteSimulation(sim.id)
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Comparison and Analysis */}
      {selectedSimulation && baseline && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Comparison Chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Revenue Comparison</CardTitle>
              <CardDescription>Baseline vs {selectedSimulation.scenario_name}</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="scenario" />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Impact Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Impact Analysis</CardTitle>
              <CardDescription>{selectedSimulation.scenario_name}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Revenue Change</p>
                <div className={`text-2xl font-bold ${revenueDifference >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {revenueDifference >= 0 ? "+" : ""}{revenueDifference.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
                {baseline.predicted_revenue > 0 && (
                  <p className="text-xs text-gray-500">
                    {((revenueDifference / baseline.predicted_revenue) * 100).toFixed(1)}% change
                  </p>
                )}
              </div>

              <div className="border-t pt-4">
                <p className="text-sm text-gray-600">Margin Change</p>
                <div className={`text-2xl font-bold ${marginDifference >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {marginDifference >= 0 ? "+" : ""}{marginDifference.toFixed(2)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Reasoning */}
      {selectedSimulation && (
        <Card>
          <CardHeader>
            <CardTitle>AI Reasoning</CardTitle>
            <CardDescription>Analysis for {selectedSimulation.scenario_name}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-700">{selectedSimulation.ai_reasoning || "No analysis available"}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
