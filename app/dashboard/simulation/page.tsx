"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { SimulationForm } from "./components/simulation-form"
import { SimulationResults } from "./components/simulation-results"
import { Spinner } from "@/components/ui/spinner"

interface Simulation {
  id: string
  scenario_name: string
  sku_id: string
  simulated_price: number
  simulated_cost: number
  projected_quantity: number
  projected_revenue: number
  projected_profit: number
  created_at: string
  sku_master?: {
    sku_code: string
    base_price: number
  }
}

export default function SimulationPage() {
  const [simulations, setSimulations] = useState<Simulation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSimulations = async () => {
      try {
        const response = await fetch("/api/simulations")
        if (response.ok) {
          const data = await response.json()
          setSimulations(data)
        }
      } catch (error) {
        console.error("Failed to fetch simulations:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchSimulations()
  }, [])

  const handleSimulationComplete = (result: any) => {
    // Refetch simulations to show new one
    const fetchSimulations = async () => {
      try {
        const response = await fetch("/api/simulations")
        if (response.ok) {
          const data = await response.json()
          setSimulations(data)
        }
      } catch (error) {
        console.error("Failed to fetch simulations:", error)
      }
    }
    fetchSimulations()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Revenue Simulations</h1>
        <p className="text-muted-foreground">
          Run what-if scenarios to analyze revenue and profit impacts
        </p>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Form */}
        <div className="lg:col-span-1">
          <SimulationForm onSimulationComplete={handleSimulationComplete} />
        </div>

        {/* Results */}
        <div className="lg:col-span-2">
          {loading ? (
            <div className="flex justify-center items-center h-96">
              <Spinner />
            </div>
          ) : (
            <SimulationResults simulations={simulations} />
          )}
        </div>
      </div>
    </div>
  )
}
