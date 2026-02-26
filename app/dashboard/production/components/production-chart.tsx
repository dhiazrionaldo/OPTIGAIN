"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { AlertCircle, CheckCircle } from "lucide-react"
import { useState } from "react"

interface ProductionChartProps {
  skuId: string
  skuCode: string
  historyData: Array<{
    month: string
    quantity: number
  }>
  onForecastGenerated: () => void
}

export function ProductionChart({
  skuId,
  skuCode,
  historyData,
  onForecastGenerated,
}: ProductionChartProps) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  )

  const handleGenerateForecast = async () => {
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch("/api/production/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku_id: skuId }),
      })

      const result = await response.json()

      if (result.success) {
        setMessage({
          type: "success",
          text: `Forecast generated: ${result.predicted_quantity} units with ${(result.confidence * 100).toFixed(1)}% confidence`,
        })
        onForecastGenerated()
      } else {
        setMessage({ type: "error", text: result.error || "Failed to generate forecast" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "An error occurred. Please try again." })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-semibold">{skuCode} - Production History</h2>
          <p className="text-sm text-muted-foreground">Last 6 months by month</p>
        </div>
        <Button onClick={handleGenerateForecast} disabled={loading}>
          {loading ? <Spinner className="mr-2" /> : null}
          {loading ? "Generating..." : "Generate Forecast"}
        </Button>
      </div>

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

      {historyData && historyData.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={historyData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(value) => `${value} units`} />
            <Legend />
            <Bar dataKey="quantity" fill="#3b82f6" name="Quantity" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
          No production data available
        </div>
      )}
    </Card>
  )
}
