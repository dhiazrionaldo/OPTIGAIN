"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, Area } from "recharts"
import { TrendingUp, AlertCircle, RefreshCw, DollarSign, TrendingDown, Percent, Lightbulb, AlertTriangle } from "lucide-react"
import { formatCompactNumber, formatCompactCurrency } from "@/lib/number-formatter"
import type { RevenueForecast, SalesPerformance, GrossProfitRow } from "@/lib/database.types"

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"]

// Custom Y-axis label formatter for compact numbers
const yAxisFormatter = (value: number) => formatCompactNumber(value)

// Custom tooltip formatter to show compact currency
const tooltipFormatter = (value: number, name: string, props: any) => {
  return [`Rp ${formatCompactNumber(value)}`, name];
};

// Enhanced tooltip for charts to show all AI reasoning and suggestions for the period/dimension
function ForecastTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    // Find all points for this period/dimension in the chart data
    const d = payload[0].payload;
    // payload is an array of all series at this x/y, but recharts only passes the visible series
    // So, we use the chart data (d._allRows) if available, else fallback to just d
    let allRows = d._allRows || [d];
    // Fallback: if _allRows is not set, try to find all rows with same period/dimension in parent data
    if (!d._allRows && d.period && d.parentData) {
      allRows = d.parentData.filter((row: any) => row.period === d.period);
    }
    // Aggregate all ai_reasoning and ai_suggestions
    const reasonings = Array.from(new Set(allRows.map((row: any) => row.ai_reasoning).filter(Boolean)));
    const suggestions = Array.from(new Set(allRows.map((row: any) => row.ai_suggestions).filter(Boolean)));
    return (
      <div style={{ background: '#18181b', border: '2px solid #3b82f6', borderRadius: 10, boxShadow: '0 10px 24px rgba(0,0,0,0.45)', padding: 16, minWidth: 260, color: '#f1f5f9', fontFamily: 'inherit' }}>
        <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 16, color: '#60a5fa' }}>{d.period || d.name}</div>
        {typeof d.value !== 'undefined' && (
          <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}><b>Revenue:</b> <span style={{ color: '#fbbf24' }}>Rp {formatCompactNumber(d.value)}</span></div>
        )}
        {typeof d.marginPercent !== 'undefined' && (
          <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}><b>Margin %:</b> <span style={{ color: '#34d399' }}>{d.marginPercent.toFixed(1)}%</span></div>
        )}
        {reasonings.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <b>AI Reasoning:</b>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 13, listStyle: reasonings.length > 1 ? 'disc' : 'none' }}>
              {reasonings.length === 1 ? (
                <li style={{ listStyle: 'none', paddingLeft: 0 }}>{reasonings[0]}</li>
              ) : (
                reasonings.map((r, i) => <li key={i}>{r}</li>)
              )}
            </ul>
          </div>
        )}
        {suggestions.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <b>AI Suggestions:</b>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 13, listStyle: suggestions.length > 1 ? 'disc' : 'none' }}>
              {suggestions.length === 1 ? (
                <li style={{ listStyle: 'none', paddingLeft: 0 }}>{suggestions[0]}</li>
              ) : (
                suggestions.map((s, i) => <li key={i}>{s}</li>)
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }
  return null;
}

// For top 10 charts, aggregate all AI info for the product/customer
function Top10Tooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    let allRows = d._allRows || [d];
    if (!d._allRows && d.name && d.parentData) {
      allRows = d.parentData.filter((row: any) => row.name === d.name);
    }
    const reasonings = Array.from(new Set(allRows.map((row: any) => row.ai_reasoning).filter(Boolean)));
    const suggestions = Array.from(new Set(allRows.map((row: any) => row.ai_suggestions).filter(Boolean)));
    
    return (
      <div style={{ background: '#18181b', border: '2px solid #3b82f6', borderRadius: 10, boxShadow: '0 10px 24px rgba(0,0,0,0.45)', padding: 16, minWidth: 260, color: '#f1f5f9', fontFamily: 'inherit' }}>
        <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 16, color: '#60a5fa' }}>{d.name}</div>
        <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 2 }}><b>Revenue:</b> <span style={{ color: '#fbbf24' }}>Rp {formatCompactNumber(d.value)}</span></div>
        {reasonings.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <b>AI Reasoning:</b>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 13, listStyle: reasonings.length > 1 ? 'disc' : 'none' }}>
              {reasonings.length === 1 ? (
                <li style={{ listStyle: 'none', paddingLeft: 0 }}>{reasonings[0]}</li>
              ) : (
                reasonings.map((r, i) => <li key={i}>{r}</li>)
              )}
            </ul>
          </div>
        )}
        {suggestions.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <b>AI Suggestions:</b>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#cbd5e1', fontSize: 13, listStyle: suggestions.length > 1 ? 'disc' : 'none' }}>
              {suggestions.length === 1 ? (
                <li style={{ listStyle: 'none', paddingLeft: 0 }}>{suggestions[0]}</li>
              ) : (
                suggestions.map((s, i) => <li key={i}>{s}</li>)
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }
  return null;
}

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
  const [companyTrend, setCompanyTrend] = useState<any[]>([])
  const [customerTrends, setCustomerTrends] = useState<Record<string, any[]>>({})
  const [productTrends, setProductTrends] = useState<Record<string, any[]>>({})
  const [selectedCustomer, setSelectedCustomer] = useState<string>("")
  const [selectedProduct, setSelectedProduct] = useState<string>("")
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

      let typedSalesData: RevenueForecast[] = [];
      if (uploadIds.length > 0) {
        const { data: rows } = await supabase
          .from("revenue_forecasts")
          .select("*")
          .eq("user_id", user.id)
          .order("level", { ascending: true })
          .order("forecast_month", { ascending: true })
          .limit(5000);
        typedSalesData = (rows || []) as RevenueForecast[];
      }

      if (typedSalesData && typedSalesData.length > 0) {
        // Group by level and dimension_value
        const companyRows = typedSalesData.filter(row => row.level?.toLowerCase() === "company")
        const customerRows = typedSalesData.filter(row => row.level?.toLowerCase() === "customer")
        const productRows = typedSalesData.filter(row => row.level?.toLowerCase() === "product")

        // Helper to build trend by period for a set of rows
        function buildTrend(rows: RevenueForecast[], groupKey: string | null = null) {
          const map = new Map()
          for (const row of rows) {
            const period = row.forecast_month
            let key = period
            if (groupKey === "dimension_value") key += "-" + (row.dimension_value || "Unknown")
            if (!map.has(key)) {
              map.set(key, {
                period,
                value: 0,
                margin: 0,
                marginPercent: 0,
                dimension: groupKey === "dimension_value" ? (row.dimension_value || "Unknown") : undefined
              })
            }
            const entry = map.get(key)
            entry.value += row.predicted_revenue || 0
            entry.margin += row.predicted_margin || 0
          }
          // Calculate margin %
          for (const entry of map.values()) {
            entry.marginPercent = entry.value > 0 ? (entry.margin / entry.value) * 100 : 0
          }
          return Array.from(map.values())
        }


        // Helper to inject all original forecast rows for each period/dimension into the chart data for tooltips
        function injectForecastRows(trend: any[], allRows: RevenueForecast[], periodKey = 'period', dimValue?: string) {
          return trend.map(t => {
            let rows = allRows.filter(r => {
              if (dimValue) {
                return r.forecast_month === t[periodKey] && r.dimension_value === dimValue;
              }
              return r.forecast_month === t[periodKey];
            });
            return { ...t, _allRows: rows };
          });
        }

        // Company trend (single line)
        setCompanyTrend(injectForecastRows(buildTrend(companyRows), companyRows));
        console.log(companyRows)
        // Customer trends (group by customer)
        const customerMap2: Record<string, RevenueForecast[]> = {};
        for (const row of customerRows) {
          const customer = row.dimension_value || "Unknown";
          if (!customerMap2[customer]) customerMap2[customer] = [];
          customerMap2[customer].push(row);
        }
        const customerTrendsObj: Record<string, any[]> = {};
        for (const customer in customerMap2) {
          customerTrendsObj[customer] = injectForecastRows(buildTrend(customerMap2[customer]), customerMap2[customer], 'period', customer);
        }
        setCustomerTrends(customerTrendsObj);

        // Product trends (group by product)
        const productMap2: Record<string, RevenueForecast[]> = {};
        for (const row of productRows) {
          const product = row.dimension_value || "Unknown";
          if (!productMap2[product]) productMap2[product] = [];
          productMap2[product].push(row);
        }
        const productTrendsObj: Record<string, any[]> = {};
        for (const product in productMap2) {
          productTrendsObj[product] = injectForecastRows(buildTrend(productMap2[product]), productMap2[product], 'period', product);
        }
        setProductTrends(productTrendsObj);

        // (Removed year-over-year and last year metrics calculation for forecast data)

        // Top 10 forecasted products (by predicted_revenue)
        const forecastedProductMap = new Map<string, number>()
        for (const row of productRows) {
          const key = row.dimension_value || "Unknown"
          forecastedProductMap.set(
            key,
            (forecastedProductMap.get(key) || 0) + (row.predicted_revenue || 0)
          )
        }
        const forecastedProducts = Array.from(forecastedProductMap.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10)
        setTopProducts(forecastedProducts)
        
        // Top 10 forecasted customers (by predicted_revenue)
        const forecastedCustomerMap = new Map<string, number>()
        for (const row of customerRows) {
          const cname = row.dimension_value || "Unknown"
          forecastedCustomerMap.set(
            cname,
            (forecastedCustomerMap.get(cname) || 0) + (row.predicted_revenue || 0)
          )
        }
        const forecastedCustomers = Array.from(forecastedCustomerMap.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10)
        setTopCustomers(forecastedCustomers)
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
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2">
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

            {/* Top Products + Top Customers */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-0 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
                <CardHeader className="pb-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-50">Top 10 Forecasted Products</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">By revenue forecasting</CardDescription>
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
                        <Tooltip content={<Top10Tooltip />} formatter={tooltipFormatter} contentStyle={{backgroundColor: "#ffffff", border: "2px solid #1e293b", borderRadius: "8px", boxShadow: "0 10px 15px rgba(0, 0, 0, 0.3)", color:"#000000"}} />
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
                      <CardTitle className="text-lg font-semibold text-slate-50">Top 10 Forecasted Customers</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">By revenue forecasting</CardDescription>
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
                        <Tooltip content={<Top10Tooltip />} formatter={tooltipFormatter} contentStyle={{backgroundColor: "#ffffff", border: "2px solid #1e293b", borderRadius: "8px", boxShadow: "0 10px 15px rgba(0, 0, 0, 0.3)", color:"#000000"}} />
                        <Bar dataKey="value" fill="#10b981" name="Revenue" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-96 items-center justify-center text-slate-500 font-medium">No customer data available</div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Company Level Chart */}
            <div className="mb-8">
              <Card className="border-0 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
                <CardHeader className="pb-4 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-50">Company Level Forecast Trend</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">Monthly company forecast (revenue & margin)</CardDescription>
                    </div>
                    <div className="rounded-lg bg-blue-100 p-3">
                      <TrendingUp className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {companyTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={350}>
                      <ComposedChart data={companyTrend}>
                        <defs>
                          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="marginGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis yAxisId="left" tickFormatter={yAxisFormatter} width={60} stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => v.toFixed(1) + "%"} width={70} stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <Tooltip content={<ForecastTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="value" fill="url(#revenueGradient)" stroke="#3b82f6" strokeWidth={2} name="Revenue" dot={{ fill: "#3b82f6", r: 4 }} activeDot={{ r: 6 }} />
                        <Line yAxisId="right" type="monotone" dataKey="marginPercent" stroke="#10b981" strokeWidth={2} name="Margin %" dot={{ fill: "#10b981", r: 4 }} activeDot={{ r: 6 }} strokeDasharray="5 5" />
                        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                      </ComposedChart>
                      {/* <BarChart data={companyTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="period" stroke="#64748b" />
                        <YAxis yAxisId="left" tickFormatter={yAxisFormatter} width={60} stroke="#64748b" />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => v.toFixed(1) + "%"} width={70} stroke="#64748b" />
                        <Tooltip content={<ForecastTooltip />} formatter={tooltipFormatter} contentStyle={{backgroundColor: "#ffffff", border: "2px solid #1e293b", borderRadius: "8px", boxShadow: "0 10px 15px rgba(0, 0, 0, 0.3)", color:"#000000"}} />
                        <Bar yAxisId="left" dataKey="value" fill="#3b82f6" name="Revenue" radius={[8, 8, 0, 0]} />
                        <Bar yAxisId="right" dataKey="marginPercent" fill="#10b981" name="Margin %" radius={[8, 8, 0, 0]} />
                        <Legend />
                      </BarChart> */}
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-96 items-center justify-center text-slate-500">No company forecast data available</div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Customer Level Chart with Selector */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-slate-50 mb-2">Customer Level Forecast Trend</h2>
              {Object.keys(customerTrends).length > 0 ? (
                <Card className="mb-4 border-0 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
                  <CardHeader className="pb-2 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold text-slate-50">Customer</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">Select a customer to view monthly forecast</CardDescription>
                    </div>
                    <select
                      className="mt-2 md:mt-0 rounded border px-2 py-1 text-slate-400"
                      value={selectedCustomer || Object.keys(customerTrends)[0]}
                      onChange={e => setSelectedCustomer(e.target.value)}
                    >
                      {Object.keys(customerTrends).map(customer => (
                        <option key={customer} value={customer}>{customer}</option>
                      ))}
                    </select>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={250}>
                      <ComposedChart data={customerTrends[selectedCustomer || Object.keys(customerTrends)[0]]}>
                        <defs>
                          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="marginGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis yAxisId="left" tickFormatter={yAxisFormatter} width={60} stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => v.toFixed(1) + "%"} width={70} stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <Tooltip content={<ForecastTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="value" fill="url(#revenueGradient)" stroke="#3b82f6" strokeWidth={2} name="Revenue" dot={{ fill: "#3b82f6", r: 4 }} activeDot={{ r: 6 }} />
                        <Line yAxisId="right" type="monotone" dataKey="marginPercent" stroke="#10b981" strokeWidth={2} name="Margin %" dot={{ fill: "#10b981", r: 4 }} activeDot={{ r: 6 }} strokeDasharray="5 5" />
                        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex h-32 items-center justify-center text-slate-500">No customer forecast data available</div>
              )}
            </div>

            {/* Product Level Chart with Selector */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-slate-50 mb-2">Product Level Forecast Trend</h2>
              {Object.keys(productTrends).length > 0 ? (
                <Card className="mb-4 border-0 shadow-md hover:shadow-lg transition-all duration-300 bg-slate-30">
                  <CardHeader className="pb-2 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold text-slate-50">Product</CardTitle>
                      <CardDescription className="mt-1 text-slate-500">Select a product to view monthly forecast</CardDescription>
                    </div>
                    <select
                      className="mt-2 md:mt-0 rounded border px-2 py-1 text-slate-400"
                      value={selectedProduct || Object.keys(productTrends)[0]}
                      onChange={e => setSelectedProduct(e.target.value)}
                    >
                      {Object.keys(productTrends).map(product => (
                        <option key={product} value={product}>{product}</option>
                      ))}
                    </select>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={250}>
                      <ComposedChart data={productTrends[selectedProduct || Object.keys(productTrends)[0]]}>
                        <defs>
                          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="marginGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis yAxisId="left" tickFormatter={yAxisFormatter} width={60} stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => v.toFixed(1) + "%"} width={70} stroke="#64748b" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <Tooltip content={<ForecastTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="value" fill="url(#revenueGradient)" stroke="#3b82f6" strokeWidth={2} name="Revenue" dot={{ fill: "#3b82f6", r: 4 }} activeDot={{ r: 6 }} />
                        <Line yAxisId="right" type="monotone" dataKey="marginPercent" stroke="#10b981" strokeWidth={2} name="Margin %" dot={{ fill: "#10b981", r: 4 }} activeDot={{ r: 6 }} strokeDasharray="5 5" />
                        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex h-32 items-center justify-center text-slate-500">No product forecast data available</div>
              )}
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
