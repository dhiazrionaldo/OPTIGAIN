import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ExecutiveCharts } from "@/app/dashboard/components/executive-charts"
import {
  getMonthlyProductionStats,
  getTopSKUsByRevenue,
  getAllSKUs,
  getLatestForecast,
  getAllSimulations,
} from "@/lib/supabase-admin-singlecompany"

export const revalidate = 300 // 5 minutes

import type { Database } from "@/lib/database.types"

type SKU = {
  id: string;
  sku_code: string;
  product_name: string;
  category: string;
  base_price: number;
  base_cost: number;
};

type Forecast = {
  predicted_quantity?: number;
  confidence?: number;
};

type Simulation = {
  scenario_name: string;
  projected_revenue: number;
  projected_profit: number;
};

async function fetchDashboardData() {
  // Get current month
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  // Fetch all data
  const skus: SKU[] = await getAllSKUs()
  const monthlyStats = await getMonthlyProductionStats(currentYear, currentMonth)
  const topSKUs = await getTopSKUsByRevenue(5)
  const simulations: Simulation[] = await getAllSimulations()

  // Calculate current month metrics
  let totalProduction = 0
  let totalRevenue = 0
  let totalProfit = 0

  monthlyStats.forEach((stat: any) => {
    const quantity = stat.quantity || 0
    const price = stat.sku_master?.base_price || 0
    const revenue = quantity * price
    totalProduction += quantity
    totalRevenue += revenue
  })

  // Get forecasts for next month
  const forecasts: (Forecast | null)[] = await Promise.all(
    skus.map((sku) => getLatestForecast(sku.id))
  )

  let forecastedProduction = 0
  let forecastedRevenue = 0
  let avgConfidence = 0
  let forecastCount = 0

  forecasts.forEach((f, idx) => {
    if (f) {
      forecastedProduction += f.predicted_quantity || 0
      const sku = skus[idx]
      forecastedRevenue += (f.predicted_quantity || 0) * (sku.base_price || 0)
      avgConfidence += f.confidence || 0
      forecastCount++
    }
  })

  avgConfidence = forecastCount > 0 ? avgConfidence / forecastCount : 0

  // Get best simulation
  const bestSimulation = simulations.length > 0
    ? simulations.reduce((best: any, sim: any) => 
        !best || (sim.projected_profit > best.projected_profit) ? sim : best
      )
    : null

  // Build charts data
  const monthlyTrendData = [
    {
      month: "This Month",
      production: totalProduction,
      forecast: forecastedProduction,
    },
  ]

  const revenueVsSimulationData = [
    {
      name: "Current",
      revenue: totalRevenue,
    },
    {
      name: "Forecasted",
      revenue: forecastedRevenue,
    },
    ...(bestSimulation ? [{
      name: bestSimulation.scenario_name,
      revenue: bestSimulation.projected_revenue,
    }] : []),
  ]

  return {
    totalProduction,
    forecastedProduction,
    totalRevenue,
    forecastedRevenue,
    projectedProfit: bestSimulation?.projected_profit || 0,
    profitMargin: totalRevenue > 0 ? ((bestSimulation?.projected_profit || 0) / totalRevenue) * 100 : 0,
    avgConfidence,
    skuCount: skus.length,
    simulationCount: simulations.length,
    topSKUs,
    monthlyTrendData,
    revenueVsSimulationData,
    bestSimulation,
    forecasts,
    skus,
  }
}

export default async function ExecutiveDashboard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const data = await fetchDashboardData()

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Executive Dashboard</h1>
        <p className="text-muted-foreground">
          Core KPIs and production insights
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="p-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              Production This Month
            </p>
            <p className="text-2xl font-bold">
              {data.totalProduction?.toLocaleString()} units
            </p>
            <p className="text-xs text-muted-foreground">
              Forecast: {data.forecastedProduction?.toLocaleString()} units next month
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              Revenue This Month
            </p>
            <p className="text-2xl font-bold">
              ${data.totalRevenue?.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-muted-foreground">
              Forecasted: ${data.forecastedRevenue?.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              GP%
            </p>
            <p className="text-2xl font-bold">
              {data.profitMargin?.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              Projected Gross Profit Margin
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              Forecast Confidence
            </p>
            <p className="text-2xl font-bold">
              {(data.avgConfidence * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              Average across {data.skuCount} SKUs
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              AI Projected Revenue
            </p>
            <p className="text-2xl font-bold">
              ${data.forecastedRevenue?.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-muted-foreground">
              Next Month (AI Forecast)
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              AI Projected GP%
            </p>
            <p className="text-2xl font-bold">
              {data.profitMargin?.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              Next Month (AI Forecast)
            </p>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <ExecutiveCharts 
        monthlyTrendData={data.monthlyTrendData}
        revenueVsSimulationData={data.revenueVsSimulationData}
      />

      {/* Top 5 SKUs */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Top 5 SKUs by Revenue</h2>
        <div className="space-y-2">
          {data.topSKUs && data.topSKUs.length > 0 ? (
            data.topSKUs.map(({ skuId, revenue }: { skuId: string; revenue: number }, idx: number) => {
              const sku = data.skus.find((s: any) => s.id === skuId)
              return (
                <div
                  key={skuId}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{idx + 1}</Badge>
                    <div>
                      <p className="font-medium">{sku?.sku_code}</p>
                      <p className="text-xs text-muted-foreground">{sku?.product_name}</p>
                    </div>
                  </div>
                  <p className="font-semibold text-right">
                    ${revenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </p>
                </div>
              )
            })
          ) : (
            <p className="text-muted-foreground">No SKUs with revenue data</p>
          )}
        </div>
      </Card>
    </div>
  )
}
