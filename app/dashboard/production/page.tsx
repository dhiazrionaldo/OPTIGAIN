import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Card } from "@/components/ui/card"
import { ProductionForm } from "./components/production-form"
import { ProductionChart } from "./components/production-chart"
import { getAllSKUs, getProductionHistoryAggregated, getLatestForecast } from "@/lib/supabase-admin-singlecompany"

export const revalidate = 60

interface ForecastData {
  [key: string]: {
    predicted_quantity: number
    confidence: number
    forecast_month: string
  }
}

export default async function ProductionPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Fetch all SKUs
  const skus = await getAllSKUs()

  // Fetch production history and forecasts for each SKU
  const skuData: Array<{
    id: string
    sku_code: string
    history: Array<{ month: string; quantity: number }>
    forecast: any
  }> = []

  for (const sku of skus) {
    const history = await getProductionHistoryAggregated(sku.id, 6)
    const forecast = await getLatestForecast(sku.id)

    skuData.push({
      id: sku.id,
      sku_code: sku.sku_code,
      history: history.map((h) => ({
        month: h.month,
        quantity: h.quantity,
      })),
      forecast,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Production Management</h1>
        <p className="text-muted-foreground">
          Record production data and generate AI forecasts
        </p>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Form */}
        <div className="lg:col-span-1">
          <ProductionForm />
        </div>

        {/* Charts & Stats */}
        <div className="lg:col-span-2 space-y-6">
          {skuData.length > 0 ? (
            skuData.map((sku) => (
              <ProductionChart
                key={sku.id}
                skuId={sku.id}
                skuCode={sku.sku_code}
                historyData={sku.history}
                onForecastGenerated={() => {
                  // This would trigger a revalidation in production
                }}
              />
            ))
          ) : (
            <Card className="p-6 text-center text-muted-foreground">
              No SKUs found. Create SKUs first.
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
