"use client"

import { Card } from "@/components/ui/card"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

interface ExecutiveChartsProps {
  monthlyTrendData: Array<{
    month: string
    production: number
    forecast: number
  }>
  revenueVsSimulationData: Array<{
    name: string
    revenue: number
  }>
}

export function ExecutiveCharts({ monthlyTrendData, revenueVsSimulationData }: ExecutiveChartsProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Production Trend */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Production Trend</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={monthlyTrendData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(value) => `${value} units`} />
            <Legend />
            <Bar dataKey="production" fill="#3b82f6" name="Actual" />
            <Bar dataKey="forecast" fill="#8b5cf6" name="Forecast" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Revenue Comparison */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Revenue Comparison</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={revenueVsSimulationData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip
              formatter={(value) =>
                `$${(value as number).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
              }
            />
            <Bar dataKey="revenue" fill="#06b6d4" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}
