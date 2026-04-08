"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { TrendingUp, AlertCircle, RefreshCw, DollarSign, TrendingDown, Percent, Lightbulb, AlertTriangle } from "lucide-react"
import { formatCompactNumber, formatCompactCurrency } from "@/lib/number-formatter"
import type { RevenueForecast, SalesPerformance, GrossProfitRow } from "@/lib/database.types"

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"]

// Custom Y-axis label formatter for compact numbers
const yAxisFormatter = (value: number) => formatCompactNumber(value)

// Custom tooltip formatter
const tooltipFormatter = (value: number) => ["Rp " + formatCompactNumber(value), ""]

export default function ExecutiveDashboard() {
  const supabase = createClient()

  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forecasting, setForecasting] = useState(false)

  const [latestRevenue, setLatestRevenue] = useState<number>(0)
  const [forecastRevenue, setForecastRevenue] = useState<number>(0)
  const [latestMargin, setLatestMargin] = useState<number>(0)
  const [forecastMargin, setForecastMargin] = useState<number>(0)
  const [revenueGrowth, setRevenueGrowth] = useState<number | null>(null)
  
  // Yearly metrics
  const [lastYearRevenue, setLastYearRevenue] = useState<number>(0)
  const [lastYearNetSales, setLastYearNetSales] = useState<number>(0)
  const [lastYearMarginPct, setLastYearMarginPct] = useState<number>(0)
  const [lastYearCogs, setLastYearCogs] = useState<number>(0)
  const [yearOverYearGrowth, setYearOverYearGrowth] = useState<number | null>(null)

  const [trendData, setTrendData] = useState<any[]>([])
  const [topProducts, setTopProducts] = useState<any[]>([])
  const [topCustomers, setTopCustomers] = useState<any[]>([])
  const [aiReasoning, setAiReasoning] = useState<string>("")
  const [aiSuggestions, setAiSuggestions] = useState<string>("")

  // Load dashboard data
  useEffect(() => {
    setMounted(true)
    loadDashboard()
  }, [])

  async function loadDashboard() {
    try {
      setLoading(true)
      setError(null)

      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) return

      // Fetch gross profit rows for the user's uploads (use this for trends)
      const { data: userUploads } = await supabase
        .from("gross_profit_uploads")
        .select("id,sheet_month,sheet_year")
        .eq("user_id", user.id)

      const uploadIds = (userUploads || []).map((u: any) => u.id)
      const uploadMap: Record<string, { sheet_month?: number; sheet_year?: number }> = {}
      for (const u of (userUploads || []) as any[]) {
        uploadMap[u.id] = { sheet_month: u.sheet_month, sheet_year: u.sheet_year }
      }

      let typedSalesData: GrossProfitRow[] = []
      if (uploadIds.length > 0) {
        const { data: rows } = await supabase
          .from("revenue_forecasts")
          .select("*")
          .in("user_id", [user.id])
          .order("level", { ascending: true })
          .order("forecast_month", { ascending: true })
          .limit(5000)

        typedSalesData = (rows || []) as GrossProfitRow[]
      }
      
      if (typedSalesData && typedSalesData.length > 0) {
        // Build trend data grouped by year-month for chart display
        const trendMap = new Map<string, { period: string; revenue: number; margin: number }>()
        // Build yearly data for metrics
        const yearlyMap = new Map<number, { revenue: number; margin: number; grossProfit: number; cogs: number }>()
        
        for (const row of typedSalesData) {
          // prefer row-level sheet info, fallback to upload-level sheet info
          const fallbackNow = new Date()
          const year = row.sheet_year || uploadMap[row.upload_id]?.sheet_year || fallbackNow.getFullYear()
          const month = row.sheet_month || uploadMap[row.upload_id]?.sheet_month || (fallbackNow.getMonth() + 1)
          
          // For trend data (monthly)
          const key = `${year}-${String(month).padStart(2, "0")}-01`
          if (!trendMap.has(key)) {
            trendMap.set(key, { period: key, revenue: 0, margin: 0 })
          }
          const trend = trendMap.get(key)!
          trend.revenue += (row as any).net_sales || 0
          trend.margin += (row as any).gross_margin_value || 0
          
          // For yearly data
          if (!yearlyMap.has(year)) {
            yearlyMap.set(year, { revenue: 0, netSales: 0, margin: 0, grossProfit: 0, cogs: 0 })
          }
          const yearly = yearlyMap.get(year)!
          yearly.revenue += (row as any).net_sales || 0
          yearly.netSales += (row as any).net_sales || 0
          yearly.margin += (row as any).gross_margin_value || 0
          yearly.grossProfit += (row as any).gross_profit || 0
          yearly.cogs += (row as any).cogs || 0
        }

        // Get all trends sorted chronologically (use full available months)
        const allTrends = Array.from(trendMap.values()).sort((a, b) => a.period.localeCompare(b.period))
        // Build a continuous 12-month series ending at the latest available month
        const lastPeriodStr = allTrends.length > 0 ? allTrends[allTrends.length - 1].period : null
        const fallbackNow = new Date()
        const lastPeriodDate = lastPeriodStr ? new Date(lastPeriodStr) : new Date(fallbackNow.getFullYear(), fallbackNow.getMonth(), 1)
        const startDate = new Date(lastPeriodDate.getFullYear(), lastPeriodDate.getMonth(), 1)
        startDate.setMonth(startDate.getMonth() - 11)

        const monthKeys: string[] = []
        for (let i = 0; i < 12; i++) {
          const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
          monthKeys.push(key)
        }
        
        const trendLookup = new Map(allTrends.map(t => [t.period, t]))
        const last12 = monthKeys.map(k => {
          const found = trendLookup.get(k)
          if (found) return { ...found, marginPercent: found.revenue > 0 ? (found.margin / found.revenue) * 100 : 0 }
          return { period: k, revenue: 0, margin: 0, marginPercent: 0 }
        })

        setTrendData(last12)

        // Calculate year-over-year growth using yearly data
        const sortedYears = Array.from(yearlyMap.keys()).sort((a, b) => b - a)
        console.log("📊 Yearly data:", Array.from(yearlyMap.entries()).map(([year, data]) => ({year, revenue: data.revenue, cogs: data.cogs, margin: data.margin, grossProfit: data.grossProfit})))
        console.log("📅 Sorted years:", sortedYears)
        if (sortedYears.length >= 2) {
          const latestYear = sortedYears[0]
          const prevYear = sortedYears[1]
          const latestYearData = yearlyMap.get(latestYear)!
          const prevYearData = yearlyMap.get(prevYear)!
          
          const latestYearRev = latestYearData.revenue
          const prevYearRev = prevYearData.revenue
          
          console.log(`📈 YoY Growth: ${latestYear} (Rp${latestYearRev}) vs ${prevYear} (Rp${prevYearRev})`)
          
          setLatestRevenue(latestYearRev)
          setLatestMargin(latestYearRev > 0 ? (latestYearData.margin / latestYearRev) * 100 : 0)
          
          // Last year metrics
          setLastYearRevenue(prevYearRev)
          setLastYearNetSales(prevYearData.netSales)
          setLastYearMarginPct(prevYearRev > 0 ? (prevYearData.margin / prevYearRev) * 100 : 0)
          setLastYearCogs(prevYearData.cogs)
          
          if (prevYearRev > 0 && latestYearRev > 0) {
            setYearOverYearGrowth(((latestYearRev - prevYearRev) / prevYearRev) * 100)
          } else {
            setYearOverYearGrowth(null)
          }
        } else if (sortedYears.length === 1) {
          const latestYear = sortedYears[0]
          const latestYearData = yearlyMap.get(latestYear)!
          const latestYearRev = latestYearData.revenue
          
          setLatestRevenue(latestYearRev)
          setLatestMargin(latestYearRev > 0 ? (latestYearData.margin / latestYearRev) * 100 : 0)
          
          setLastYearRevenue(0)
          setLastYearNetSales(0)
          setLastYearMarginPct(0)
          setLastYearCogs(0)
          setYearOverYearGrowth(null)
        }

        // Top products (use product_spec)
        const productMap = new Map<string, number>()
        for (const row of typedSalesData) {
          const key = (row as any).product_spec || "Unknown"
          productMap.set(
            key,
            (productMap.get(key) || 0) + ((row as any).net_sales || 0)
          )
        }
        const products = Array.from(productMap.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10)
        setTopProducts(products)

        // Top customers
        const customerMap = new Map<string, number>()
        for (const row of typedSalesData) {
          const cname = (row as any).customer_name || "Unknown"
          customerMap.set(
            cname,
            (customerMap.get(cname) || 0) + ((row as any).net_sales || 0)
          )
        }
        const customers = Array.from(customerMap.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10)
        setTopCustomers(customers)
      }

      // Fetch latest forecast
      const { data: forecastData } = await supabase
        .from("revenue_forecasts")
        .select("*")
        .eq("user_id", user.id)
        .eq("level", "company")
        .order("created_at", { ascending: false })
        .limit(1)

      const typedForecastData = (forecastData || []) as RevenueForecast[]

      if (typedForecastData && typedForecastData.length > 0) {
        const forecast = typedForecastData[0]
        setForecastRevenue(forecast.predicted_revenue)
        // Calculate margin % using formula: Gross Margin % = Gross Margin Value / Net Sales
        const forecastMarginPct = forecast.predicted_revenue > 0 ? (forecast.predicted_margin / forecast.predicted_revenue) * 100 : 0
        setForecastMargin(forecastMarginPct)
        setAiReasoning(forecast.ai_reasoning || "")
        setAiSuggestions(forecast.ai_suggestions || "")
      }
    } catch (err) {
      console.error("Error loading dashboard:", err)
      setError("Failed to load dashboard data")
    } finally {
      setLoading(false)
    }
  }

  async function handleForecast() {
    try {
      setForecasting(true)
      setError(null)

      const response = await fetch("/api/revenue/forecast", { method: "POST" })
      const result = await response.json()

      if (!result.success) {
        setError(result.error || "Forecasting failed")
        return
      }

      await loadDashboard()
    } catch (err) {
      setError("Failed to run forecast")
      console.error(err)
    } finally {
      setForecasting(false)
    }
  }

  if (!mounted || loading) {
    return (
      <div className="space-y-8 p-2">
        <Skeleton className="h-32 w-full bg-secondary" />
        <Skeleton className="h-64 w-full bg-secondary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full p-4">
      <div className="mx-auto space-y-8">

        {/* Header + AI Cards side by side */}
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          
          {/* Left: Header + everything below */}
          <div className="space-y-8">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="mb-2 text-4xl font-bold text-slate-50">Forecasting</h1>
                <p className="text-lg text-slate-50">AI-powered revenue intelligence & insights</p>
              </div>
              <Button
                onClick={handleForecast}
                disabled={forecasting}
                size="lg"
                className="h-12 gap-2 bg-blue-600 hover:bg-blue-700 transition-all duration-200 shadow-md hover:shadow-lg"
              >
                {forecasting ? <RefreshCw className="h-5 w-5 animate-spin" /> : <TrendingUp className="h-5 w-5" />}
                {forecasting ? "Forecasting..." : "Run Forecast"}
              </Button>
            </div>

            {/* Alerts */}
            {error && (
              <Alert variant="destructive" className="border-l-4 border-l-red-500 bg-red-50">
                <AlertCircle className="h-5 w-5 text-red-600" />
                <AlertDescription className="text-red-800 font-medium">{error}</AlertDescription>
              </Alert>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {/* <div className="group">
                <Card className="border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 border-t-blue-500 bg-slate-30 hover:bg-secondary">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-sm font-semibold text-slate-50">Current Year Revenue</CardTitle>
                      </div>
                      <div className="rounded-lg bg-blue-100 p-2.5 group-hover:bg-blue-200 transition-colors">
                        <DollarSign className="h-5 w-5 text-blue-600" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className="text-3xl font-bold text-slate-200">Rp {formatCompactNumber(latestRevenue)}</div>
                    <p className="mt-2 text-xs font-medium text-slate-500">Year-to-date</p>
                  </CardContent>
                </Card>
              </div> */}

              <div className="group">
                <Card className="border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 border-t-green-500 bg-slate-30 hover:bg-secondary">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-sm font-semibold text-slate-50">Forecast Revenue</CardTitle>
                      </div>
                      <div className="rounded-lg bg-green-100 p-2.5 group-hover:bg-green-200 transition-colors">
                        <TrendingUp className="h-5 w-5 text-green-600" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className="text-3xl font-bold text-slate-200">Rp {formatCompactNumber(forecastRevenue)}</div>
                    <p className="mt-2 text-xs font-medium text-slate-500">Next month projection</p>
                  </CardContent>
                </Card>
              </div>

              {/* <div className="group">
                <Card className={`border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 ${yearOverYearGrowth >= 0 ? "border-t-green-500" : "border-t-red-500"} bg-slate-30 hover:bg-secondary`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-sm font-semibold text-slate-50">Year-over-Year Growth</CardTitle>
                      </div>
                      <div className={`rounded-lg p-2.5 transition-colors ${yearOverYearGrowth >= 0 ? "bg-green-100 group-hover:bg-green-200" : "bg-red-100 group-hover:bg-red-200"}`}>
                        {yearOverYearGrowth >= 0 ? (
                          <TrendingUp className="h-5 w-5 text-green-600" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-red-600" />
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className={`text-3xl font-bold ${yearOverYearGrowth >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {yearOverYearGrowth?.toFixed(1) ?? "N/A"}%
                    </div>
                    <p className="mt-2 text-xs font-medium text-slate-500">Year-over-year</p>
                  </CardContent>
                </Card>
              </div> */}

              {/* <div className="group">
                <Card className="border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 border-t-purple-500 bg-slate-30 hover:bg-secondary">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-sm font-semibold text-slate-50">Current Margin %</CardTitle>
                      </div>
                      <div className="rounded-lg bg-purple-100 p-2.5 group-hover:bg-purple-200 transition-colors">
                        <Percent className="h-5 w-5 text-purple-600" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className="text-3xl font-bold text-slate-200">{latestMargin.toFixed(1)}%</div>
                    <p className="mt-2 text-xs font-medium text-slate-500">Gross margin</p>
                  </CardContent>
                </Card>
              </div> */}

              <div className="group">
                <Card className="border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 border-t-green-500 bg-slate-30 hover:bg-secondary">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-sm font-semibold text-slate-50">Forecast Gross Margin %</CardTitle>
                      </div>
                      <div className="rounded-lg bg-green-100 p-2.5 group-hover:bg-green-200 transition-colors">
                        <Percent className="h-5 w-5 text-green-600" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className="text-3xl font-bold text-slate-200">{forecastMargin.toFixed(1)}%</div>
                    <p className="mt-2 text-xs font-medium text-slate-500">Next month projection</p>
                  </CardContent>
                </Card>
              </div>
            </div>
            

            {/* Last Year Metrics Cards */}
            {/* <div>
              <h2 className="text-lg font-semibold text-slate-50 mb-4">Last Year Summary</h2>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                <div className="group">
                  <Card className="border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 border-t-blue-500 bg-slate-30 hover:bg-secondary">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-sm font-semibold text-slate-50">Last Year Revenue</CardTitle>
                        </div>
                        <div className="rounded-lg bg-blue-100 p-2.5 group-hover:bg-blue-200 transition-colors">
                          <DollarSign className="h-5 w-5 text-blue-600" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-3">
                      <div className="text-3xl font-bold text-slate-200">Rp {formatCompactNumber(lastYearRevenue)}</div>
                      <p className="mt-2 text-xs font-medium text-slate-500">Previous year total</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="group">
                  <Card className="border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 border-t-cyan-500 bg-slate-30 hover:bg-secondary">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-sm font-semibold text-slate-50">Last Year Net Sales</CardTitle>
                        </div>
                        <div className="rounded-lg bg-cyan-100 p-2.5 group-hover:bg-cyan-200 transition-colors">
                          <DollarSign className="h-5 w-5 text-cyan-600" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-3">
                      <div className="text-3xl font-bold text-slate-200">Rp {formatCompactNumber(lastYearNetSales)}</div>
                      <p className="mt-2 text-xs font-medium text-slate-500">Net sales revenue</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="group">
                  <Card className="border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 border-t-orange-500 bg-slate-30 hover:bg-secondary">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-sm font-semibold text-slate-50">Last Year Margin %</CardTitle>
                        </div>
                        <div className="rounded-lg bg-orange-100 p-2.5 group-hover:bg-orange-200 transition-colors">
                          <Percent className="h-5 w-5 text-orange-600" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-3">
                      <div className="text-3xl font-bold text-slate-200">{lastYearMarginPct.toFixed(1)}%</div>
                      <p className="mt-2 text-xs font-medium text-slate-500">Net margin</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="group">
                  <Card className="border-0 shadow-md hover:shadow-xl transition-all duration-300 h-full border-t-4 border-t-red-500 bg-slate-30 hover:bg-secondary">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-sm font-semibold text-slate-50">Last Year COGS</CardTitle>
                        </div>
                        <div className="rounded-lg bg-red-100 p-2.5 group-hover:bg-red-200 transition-colors">
                          <DollarSign className="h-5 w-5 text-red-600" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-3">
                      <div className="text-3xl font-bold text-slate-200">Rp {formatCompactNumber(lastYearCogs)}</div>
                      <p className="mt-2 text-xs font-medium text-slate-500">Cost of goods sold</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div> */}

            {/* Top Products + Top Customers */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-0 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
                <CardHeader className="pb-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-50">Top 10 Products</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">By revenue</CardDescription>
                    </div>
                    <div className="rounded-lg bg-blue-100 p-3">
                      <DollarSign className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {topProducts.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={topProducts}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis tickFormatter={yAxisFormatter} width={50} stroke="#64748b" />
                        <Tooltip formatter={tooltipFormatter} contentStyle={{ backgroundColor: "#ffffff", border: "2px solid #1e293b", borderRadius: "8px", boxShadow: "0 10px 15px rgba(0,0,0,0.3)", color: "#000000" }} />
                        <Bar dataKey="value" fill="#3b82f6" name="Revenue" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-96 items-center justify-center text-slate-500 font-medium">No product data available</div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
                <CardHeader className="pb-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-50">Top 10 Customers</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">By revenue</CardDescription>
                    </div>
                    <div className="rounded-lg bg-green-100 p-3">
                      <TrendingUp className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {topCustomers.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={topCustomers} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" tickFormatter={yAxisFormatter} stroke="#64748b" />
                        <YAxis width={100} dataKey="name" type="category" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <Tooltip formatter={tooltipFormatter} contentStyle={{ backgroundColor: "#ffffff", border: "2px solid #1e293b", borderRadius: "8px", boxShadow: "0 10px 15px rgba(0,0,0,0.3)", color: "#000000" }} />
                        <Bar dataKey="value" fill="#10b981" name="Revenue" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-96 items-center justify-center text-slate-500 font-medium">No customer data available</div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Revenue Trend + Margin Trend */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-0 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
                <CardHeader className="pb-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-50">12-Month Revenue Trend</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">Monthly net sales performance</CardDescription>
                    </div>
                    <div className="rounded-lg bg-blue-100 p-3">
                      <TrendingUp className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {trendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="period" stroke="#64748b" />
                        <YAxis tickFormatter={yAxisFormatter} width={60} stroke="#64748b" />
                        <Tooltip
                          formatter={(value: number) => ["Rp " + formatCompactNumber(value), "Revenue"]}
                          contentStyle={{ backgroundColor: "#ffffff", border: "2px solid #1e293b", borderRadius: "8px", boxShadow: "0 10px 15px rgba(0,0,0,0.3)", color: "#000000" }}
                        />
                        <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-96 items-center justify-center text-slate-500">No data available</div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
                <CardHeader className="pb-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-50">Gross Margin Trend</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">Monthly margin percentage</CardDescription>
                    </div>
                    <div className="rounded-lg bg-green-100 p-3">
                      <Percent className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {trendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="period" stroke="#64748b" />
                        <YAxis tickFormatter={(v: number) => v.toFixed(1) + "%"} width={70} stroke="#64748b" />
                        <Tooltip
                          formatter={(value: number) => [`${(value as number).toFixed(1)}%`, "Margin"]}
                          contentStyle={{ backgroundColor: "#ffffff", border: "2px solid #1e293b", borderRadius: "8px", boxShadow: "0 10px 15px rgba(0,0,0,0.3)", color: "#000000" }}
                        />
                        <Bar dataKey="marginPercent" fill="#10b981" name="Margin %" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-96 items-center justify-center text-slate-500">No data available</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* RIGHT: AI Cards — spans full height next to everything */}
          <div className="flex flex-col gap-6 lg:sticky lg:top-8 lg:self-start">
            <Card className="border-0 border-t-4 border-t-blue-500 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
              <CardHeader className="pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-100 p-2.5">
                    <Lightbulb className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-50">AI Reasoning</CardTitle>
                    <CardDescription className="text-slate-500">Forecast methodology & analysis</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <p className="leading-relaxed text-slate-50 text-sm font-medium">
                  {aiReasoning || <span className="text-slate-500 italic">Run forecast to see AI reasoning for predictions</span>}
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 border-t-4 border-t-green-500 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
              <CardHeader className="pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-green-100 p-2.5">
                    <AlertTriangle className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-50">Strategic Suggestions</CardTitle>
                    <CardDescription className="text-slate-500">AI-powered recommendations</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                {aiSuggestions ? (
                  <ul className="space-y-2 text-slate-50 text-sm font-medium list-disc list-inside">
                    {aiSuggestions.split("|").filter(item => item.trim()).map((suggestion, idx) => (
                      <li key={idx} className="leading-relaxed">{suggestion.trim()}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-slate-500 italic">Run forecast to see AI recommendations</span>
                )}
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  )
}
