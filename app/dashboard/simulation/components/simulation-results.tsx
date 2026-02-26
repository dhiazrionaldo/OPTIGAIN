"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { TrendingUp, TrendingDown } from "lucide-react"

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

interface SimulationResultsProps {
  simulations: Simulation[]
}

export function SimulationResults({ simulations }: SimulationResultsProps) {
  const calculateDeltas = (sim: Simulation, baseSku: any) => {
    if (!baseSku) return { revenue: 0, profit: 0, revenuePct: 0, profitPct: 0 }

    const baseRevenue = sim.projected_quantity * baseSku.base_price
    const baseProfit = sim.projected_quantity * (baseSku.base_price - sim.simulated_cost)

    const deltaRevenue = sim.projected_revenue - baseRevenue
    const deltaProfit = sim.projected_profit - baseProfit

    return {
      revenue: deltaRevenue,
      profit: deltaProfit,
      revenuePct: baseRevenue > 0 ? (deltaRevenue / baseRevenue) * 100 : 0,
      profitPct: baseProfit > 0 ? (deltaProfit / baseProfit) * 100 : 0,
    }
  }

  if (!simulations || simulations.length === 0) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        No simulations yet. Create a simulation to see results.
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-4">Simulation Results</h2>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Revenue Δ</TableHead>
              <TableHead className="text-right">Profit Δ</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {simulations.map((sim) => {
              const deltas = calculateDeltas(sim, sim.sku_master)
              return (
                <TableRow key={sim.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{sim.scenario_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {sim.sku_master?.sku_code}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    ${sim.simulated_price.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    ${sim.simulated_cost.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {sim.projected_quantity?.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    ${sim.projected_revenue?.toLocaleString("en-US", {
                      maximumFractionDigits: 0,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${sim.projected_profit?.toLocaleString("en-US", {
                      maximumFractionDigits: 0,
                    })}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      deltas.revenue >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {deltas.revenue >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      ${deltas.revenue.toFixed(0)} ({deltas.revenuePct.toFixed(1)}%)
                    </div>
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      deltas.profit >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {deltas.profit >= 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      ${deltas.profit.toFixed(0)} ({deltas.profitPct.toFixed(1)}%)
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(sim.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
