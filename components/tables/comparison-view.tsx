"use client"

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { RefreshCw, Clock, Layers, Zap, ArrowLeftRight, ChevronDown, ChevronRight, File, Loader2 } from "lucide-react"
import type { GrossProfitRow, AIRecommendation } from "@/lib/database.types"
import { Input } from "../ui/input"
import {   ButtonGroup, ButtonGroupSeparator, ButtonGroupText, } from "../ui/button-group"
import { toast } from "sonner"
import { AIRecommendations } from "@/lib/n8n-webhook-ai-suggestion"
import { CustomerStrategy, CustomerStrategyCarousel } from "../suggestion-card/suggestion-card"
import { set } from "date-fns"



// Simple virtual scrolling hook - renders only visible items
function useVirtualScroll(items: number, itemHeight: number, containerHeight: number, scrollTop: number) {
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 1)
  const endIndex = Math.min(items, Math.ceil((scrollTop + containerHeight) / itemHeight) + 1)
  const offsetY = startIndex * itemHeight
  return { startIndex, endIndex, offsetY, visibleCount: endIndex - startIndex }
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  const display = value > 1 ? value : value * 100
  return `${display.toFixed(1)}%`
}

function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return value.toFixed(4)
}

function formatMonthYear(month: number | null | undefined, year: number | null | undefined): string {
  if (!month || !year) return "Unknown"
  return new Date(year, month - 1).toLocaleString("default", { month: "long", year: "numeric" })
}

interface ComparisonViewProps {
  uploadId: string
  rows: GrossProfitRow[]
  recommendations: AIRecommendation[]
}

const ROWS_PER_PAGE = 15

type RowWithSpan = GrossProfitRow & { rowSpan?: number; isFirstOfCustomer?: boolean }

export function ComparisonView({ uploadId, rows, recommendations }: ComparisonViewProps) {
  const router = useRouter()
  const [recos, setRecos] = useState<AIRecommendation[]>(recommendations)
  const hasRecommendations = recos.length > 0
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState<Record<string, number>>({})
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState("comparison")
  const [scrollPositions, setScrollPositions] = useState<Record<string, number>>({})
  const qtyTriggerTimer = useRef<number | null>(null)
  const qtyInputTimer = useRef<number | null>(null)
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [isLoading, setLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [hasAiFetched, setHasAiFetched] = useState(false);
  const [aiStrategies, setAiStrategies] = useState<CustomerStrategy[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  
  useEffect(() => {
    setRecos(recommendations)
  }, [recommendations])

  async function fetchRecommendations() {
    try {
      const resp = await fetch(`/api/recommendations?upload_id=${uploadId}`)
      if (!resp.ok) return
      const data = await resp.json()
      if (data.success) {
        setRecos(data.recommendations || [])
      }

    } catch (e) {
      console.error("Error fetching recommendations", e)
      toast.error("Failed to fetch recommendations")
    }
  }

  async function fetchAiStrategies() {
    setIsAiLoading(true);
    setAiError(null);
    try {
      const aiResponse = await fetch(`${process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL_AI_PRODUCT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_id: uploadId }),
      });
      if (!aiResponse.ok) {
        throw new Error(`Webhook responded with status ${aiResponse.status}`);
      }
      const aiData = await aiResponse.json();
      const cleanData = aiData.recommendations[0]?.recommendations || aiData.recommendations?.recommendations || aiData.recommendations || [];
      // Handle multiple possible shapes from n8n:
      // Shape A: [{ recommendations: [...] }]
      // Shape B: { recommendations: [...] }
      // Shape C: direct array of CustomerStrategy objects
      // let cleanData: CustomerStrategy[] = [];
      // if (Array.isArray(aiData)) {
      //   const first = aiData[0];
      //   if (first?.recommendations) {
      //     cleanData = first.recommendations; // Shape A
      //   } else if (first?.customerId !== undefined) {
      //     cleanData = aiData; // Shape C
      //   }
      // } else if (aiData?.recommendations) {
      //   cleanData = aiData.recommendations; // Shape B
      // }

      if (!Array.isArray(cleanData) || cleanData.length === 0) {
        console.warn("AI strategies response was empty or unrecognised shape:", aiData);
        setAiError("Received empty strategy data from the AI service.");
      } else {
        setAiStrategies(cleanData);
        setHasAiFetched(true);
        toast.success("AI Strategy generated successfully!");
      }
      console.log("AI Data received from n8n:", aiData, "-> parsed", cleanData.length, "strategies");
    } catch (error) {
      console.error("Error fetching AI strategies:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      setAiError(`Failed to load AI strategies: ${msg}`);
      toast.error("Failed to fetch AI strategies");
    } finally {
      setIsAiLoading(false);
    }
  }

  useEffect(() => {
    fetchRecommendations()
    fetchAiStrategies()
  }, [uploadId])

  function toggleMonth(key: string) {
    const next = new Set(expandedMonths)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedMonths(next)
  }

  const recoByRowIdForSort = useMemo(() => {
    const m = new Map<string, string>()
    recos.forEach((r) => {
      if (r.original_row_id) m.set(r.original_row_id as string, r.action || "")
    })
    return m
  }, [recos])

  const groupedByMonth = useMemo(() => {
    const groups = new Map<string, { month: number; year: number; rows: GrossProfitRow[] }>()
    for (const r of rows) {
      const month = r.sheet_month || 0
      const year = r.sheet_year || 0
      const key = `${year}-${month}`
      if (!groups.has(key)) groups.set(key, { month, year, rows: [] })
      groups.get(key)!.rows.push(r)
    }
    return Array.from(groups.values())
      .sort((a, b) => (b.year - a.year) || (b.month - a.month))
      .map((g) => {
        g.rows.sort((a, b) => {
          if (a.customer_name !== b.customer_name) return a.customer_name.localeCompare(b.customer_name)
          const order: Record<string, number> = { BOOST: 0, REDUCE: 1, REPLACE: 2 }
          const oa = recoByRowIdForSort.get(a.id)
          const ob = recoByRowIdForSort.get(b.id)
          if (oa && ob && oa !== ob) return (order[oa] ?? 3) - (order[ob] ?? 3)
          return (a.product_spec || "").localeCompare(b.product_spec || "")
        })
        return g
      })
  }, [rows, recoByRowIdForSort])

  const groupedByPredictionMonth = useMemo(() => {
  // Build a map from row id -> prediction month/year via recos
  const rowToPrediction = new Map<string, { month: number; year: number }>()
  recos.forEach((r) => {
    if (r.original_row_id && r.prediction_month && r.prediction_year) {
      rowToPrediction.set(r.original_row_id, {
        month: r.prediction_month,
        year: r.prediction_year,
      })
    }
  })

  const groups = new Map<string, { month: number; year: number; rows: GrossProfitRow[] }>()
  for (const r of rows) {
    const pred = rowToPrediction.get(r.id)

    if (!pred) continue

    const month = pred?.month || r.sheet_month || 0
    const year = pred?.year || r.sheet_year || 0
    const key = `${year}-${month}`
    if (!groups.has(key)) groups.set(key, { month, year, rows: [] })
    groups.get(key)!.rows.push(r)
  }

  return Array.from(groups.values())
    .sort((a, b) => (b.year - a.year) || (b.month - a.month))
    .map((g) => {
      g.rows.sort((a, b) => {
        if (a.customer_name !== b.customer_name) return a.customer_name.localeCompare(b.customer_name)
        const order: Record<string, number> = { BOOST: 0, REDUCE: 1, REPLACE: 2 }
        const oa = recoByRowIdForSort.get(a.id)
        const ob = recoByRowIdForSort.get(b.id)
        if (oa && ob && oa !== ob) return (order[oa] ?? 3) - (order[ob] ?? 3)
        return (a.product_spec || "").localeCompare(b.product_spec || "")
      })
      return g
    })
}, [rows, recos, recoByRowIdForSort])

  // State for alert dialog
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Function to send prediction period to webhook
  async function sendPredictionPeriod(period: number) {
  setLoading(true)
    try {
      const res = await fetch('/api/trigger-predictions-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_id: uploadId, period, action: 'period_trigger' }),
      });

      const data = await res.json();

      console.log('res.status:', res.status)
      console.log('res.ok:', res.ok)
      console.log('data:', data)
      if (!res.ok) throw new Error(data.error || 'Failed to send period');
      
      setAlert({ type: 'success', message: `Prediction period ${period} sent successfully!` });
      toast.success(`Prediction period ${period} sent successfully!`);
    } catch (e: any) {
      setAlert({ type: 'error', message: e?.message || 'Failed to send prediction period.' });
      toast.error(`Failed to send prediction period: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false)
    }
  }
  // async function sendPredictionPeriod(period: number) {
  //   setLoading(true);
  //   try {
  //     const res = await fetch('/api/trigger-predictions-period', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ upload_id: uploadId, period, action: 'period_trigger' }),
  //     });

  //     const data = await res.json();
  //     if (!res.ok) throw new Error(data.error || 'Failed to send period');
  //     setAlert({ type: 'success', message: `Prediction period ${period} sent successfully!` });
  //     toast.success(`Prediction period ${period} successfully!`);
  //   } catch (e) {
  //     setLoading(false);
  //     console.log('console: ', e)
  //     setAlert({ type: 'error', message: e?.message || 'Failed to send prediction period.' });
  //     toast.error(`Failed to send prediction period: ${e?.message || 'Unknown error'}`);
  //   } 
  //     setLoading(false);
  // }
  async function updateRowField(rowId: string, updates: Record<string, any>) {
    setUpdatingIds((prev) => new Set(prev).add(rowId))
    console.log("updateRowField called with:", { rowId, uploadId, updates })
    try {
      const payload = { rowId, upload_id: uploadId, ...updates }
      console.log("Sending payload to API:", payload)

      const response = await fetch("/api/update-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      console.log("API response status:", response.status)

      if (!response.ok) {
        const data = await response.json()
        console.error("Failed to update row:", {
          status: response.status,
          error: data.error,
          details: data.details,
          debug: data.debug
        })
        let errorMsg = `Failed to update row: ${data.error}`
        if (data.debug) errorMsg += `\nDebug: ${JSON.stringify(data.debug)}`
        if (data.details) errorMsg += `\nDetails: ${data.details}`
        alert(errorMsg)
        return
      }

      const result = await response.json()
      console.log("API response successful:", result)

      if (result.recommendations) {
        console.log("Updating local recos from API response")
        setRecos(result.recommendations)
      }

      await new Promise((resolve) => setTimeout(resolve, 300))

      console.log("Refreshing page to fetch updated data...")
      router.refresh()

      if (updates.hasOwnProperty("quantity")) {
        console.log("Quantity changed, triggering predictions...")

        try {
          if (qtyTriggerTimer.current) window.clearTimeout(qtyTriggerTimer.current)
        } catch (e) {
          /* ignore */
        }

        fetch("/api/trigger-predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ upload_id: uploadId, action: "qty_updated", rowId }),
        }).then((triggerResponse) => {
          console.log("Trigger-predictions response:", triggerResponse.status)
        }).catch((e) => {
          console.error("Error triggering predictions:", e)
        })

        setTimeout(() => {
          console.log("Fetching latest recommendations after qty update")
          fetchRecommendations()
        }, 1500)
      }

    } catch (e) {
      console.error("Error updating row:", e)
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      setUpdatingIds((prev) => {
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
      console.log("Update complete for row:", rowId)
    }
  }

  useEffect(() => {
    return () => {
      if (qtyTriggerTimer.current) {
        try { window.clearTimeout(qtyTriggerTimer.current) } catch (e) { /* ignore */ }
      }
    }
  }, [])

  async function triggerRefresh() {
    try {
      await fetch("/api/trigger-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadId, action: "manual_refresh" }),
      })
      router.refresh()
    } catch (e) {
      console.error(e)
    }
  }

  async function updateAISuggestion(recoId: string, reco: AIRecommendation,) {
    setUpdatingIds((prev) => new Set(prev).add(recoId))
    try {
      const response = await fetch("/api/update-ai-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoId, reco }),
      })
      
      if (!response.ok) {
        const data = await response.json()
        toast.error(`Failed to update AI suggestion: ${data.error}`)
        console.error("Failed to update AI suggestion:", data.error)
        return
      }

      // Wait a bit for backend to trigger n8n webhook
      // await new Promise((resolve) => setTimeout(resolve, 300))

      // Poll for updated recommendations (max 10s, every 800ms)
      const maxAttempts = 12;
      let attempt = 0;
      let updated = false;
      while (attempt < maxAttempts && !updated) {
        const recosResp = await fetch(`/api/recommendations?upload_id=${uploadId}`);
        if (recosResp.ok) {
          const data = await recosResp.json();
          // You may want to check a specific field for update, here we just check if recommendations changed
          if (data && data.recommendations) {
            setRecos(data.recommendations);
            // Optionally, check if the updated reco is reflected in the new data
            const found = data.recommendations.find((r: any) => r.original_row_id === recoId && r.suggested_quantity === reco.suggested_quantity);
            if (found) {
              updated = true;
              break;
            }
          }
        }
        attempt++;
        // await new Promise((resolve) => setTimeout(resolve, 800));
      }
      
      toast.success("AI suggestion updated successfully")
      await fetchRecommendations();
      await router.refresh();
    } catch (e) {
      console.error("Error updating AI suggestion:", e)
      toast.error(`Error to update AI suggestion: ${e}`)
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev)
        next.delete(recoId)
        return next
      })
    }
  }

  const recoMap = new Map<string, AIRecommendation>()
  for (const reco of recos) {
    recoMap.set(`${reco.customer_name}::${reco.product_spec}`, reco)
  }

  function getDisplayRows(monthRows: GrossProfitRow[], page: number): RowWithSpan[] {
    const start = page * ROWS_PER_PAGE
    const end = start + ROWS_PER_PAGE
    const paged = monthRows.slice(start, end)
    const result: RowWithSpan[] = []
    for (let i = 0; i < paged.length; i++) {
      const row = paged[i]
      const isFirst = i === 0 || paged[i - 1].customer_name !== row.customer_name
      if (isFirst) {
        let span = 1
        for (let j = i + 1; j < paged.length; j++) {
          if (paged[j].customer_name === row.customer_name) span++
          else break
        }
        result.push({ ...row, rowSpan: span, isFirstOfCustomer: true })
      } else result.push({ ...row, isFirstOfCustomer: false })
    }
    return result
  }

  function getRecoDisplayRows(recoList: AIRecommendation[]) {
    const list = [...recoList].sort((a, b) => {
      if (a.customer_name !== b.customer_name) return a.customer_name.localeCompare(b.customer_name)
      return (a.product_spec || "").localeCompare(b.product_spec || "")
    })
    const result: Array<AIRecommendation & { rowSpan?: number; isFirstOfCustomer?: boolean }> = []
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      const isFirst = i === 0 || list[i - 1].customer_name !== r.customer_name
      if (isFirst) {
        let span = 1
        for (let j = i + 1; j < list.length; j++) {
          if (list[j].customer_name === r.customer_name) span++
          else break
        }
        result.push({ ...r, rowSpan: span, isFirstOfCustomer: true })
      } else {
        result.push({ ...r, isFirstOfCustomer: false })
      }
    }
    return result
  }

  function getTotals(monthRows: GrossProfitRow[]) {
    return {
      quantity: monthRows.reduce((s, r) => s + (r.quantity || 0), 0),
      amount_sales: monthRows.reduce((s, r) => s + (r.amount_sales || 0), 0),
      freight_cost: monthRows.reduce((s, r) => s + (r.freight_cost || 0), 0),
      net_sales: monthRows.reduce((s, r) => s + (r.net_sales || 0), 0),
      cogs: monthRows.reduce((s, r) => s + (r.cogs || 0), 0),
      gross_margin_value: monthRows.reduce((s, r) => s + (r.gross_margin_value || 0), 0),
    }
  }

  const LoadingDots = () => (
    <div className="flex items-center justify-center gap-1">
      <div className="flex gap-0.5">
        <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" />
        <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.1s" }} />
        <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.2s" }} />
      </div>
    </div>
  )

  // Only show the latest AI suggestion per original_row_id (by created_at desc)
  const latestRecosMap = useMemo(() => {
    const map = new Map<string, AIRecommendation>()
    for (const reco of recos) {
      if (!reco.original_row_id) continue
      const existing = map.get(reco.original_row_id)
      if (!existing || new Date(reco.created_at) > new Date(existing.created_at)) {
        map.set(reco.original_row_id, reco)
      }
    }
    return map
  }, [recos])

  const latestRecos = Array.from(latestRecosMap.values())
  const aiPage = currentPage["ai"] || 0
  const aiTotalPages = Math.max(1, Math.ceil(latestRecos.length / ROWS_PER_PAGE))
  const aiStart = aiPage * ROWS_PER_PAGE
  const aiPaged = latestRecos.slice(aiStart, aiStart + ROWS_PER_PAGE)
  const aiDisplay = getRecoDisplayRows(aiPaged)

  //new ai card
  
  return (
    <div className="flex flex-col gap-3">
      {/* Status bar */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          {/* Show period/month count */}
          <Badge variant="secondary" className="gap-1.5 bg-accent/15 text-accent ring-1 ring-accent/20 font-mono text-xs">
            <span className="h-3 w-3 flex items-center justify-center">
              <File className="h-3 w-3 text-secondary-foreground" />
            </span>
            {groupedByMonth.length} {groupedByMonth.length === 1 ? 'month data' : 'month data'}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={triggerRefresh} className="h-8 gap-2 text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-secondary border border-border h-8 sm:h-10 p-0.5 sm:p-1 rounded-lg gap-0.5 sm:gap-1 flex-wrap sm:flex-nowrap">
          {hasRecommendations && (
            <TabsTrigger value="comparison" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
              <ArrowLeftRight className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
              <span className="hidden sm:inline">Comparison</span>
              <span className="sm:hidden">Compare</span>
              {/* <Zap className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
              <span className="hidden sm:inline">AI Suggestion</span>
              <span className="sm:hidden">AI</span> */}
            </TabsTrigger>
          )}
          <TabsTrigger value="original" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
            <Layers className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
            <span className="hidden sm:inline">Original</span>
            <span className="sm:hidden">Source</span>
          </TabsTrigger>
          <TabsTrigger value="ai1" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
            <Zap className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
            <span className="hidden sm:inline">AI Suggestion</span>
            <span className="sm:hidden">AI</span>
          </TabsTrigger>
          
        </TabsList>

        {/* AI Tab */}
        {activeTab === "ai0" && (
          <TabsContent value="ai1" className="mt-3 space-y-3">
            {/* Prediction Period Button Group */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-muted-foreground">Prediction Period:</span>
              <ButtonGroup aria-label="Button group">
              {[...Array(12)].map((_, idx) => (
               
                  <Button key={idx + 1}
                  className="rounded border border-border bg-secondary text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                  onClick={() => sendPredictionPeriod(idx + 1)}>
                    {idx + 1}
                  </Button>
              ))}
              
              </ButtonGroup>
            </div>
            {/* Alert for success/error */}
            {alert && (
              <div className={`my-2`}>
                <div className={`flex items-center gap-2 px-4 py-2 rounded border ${alert.type === 'success' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
                  <span className="font-semibold">{alert.type === 'success' ? 'Success:' : 'Error:'}</span>
                  <span>{alert.message}</span>
                  <button className="ml-auto text-xs underline" onClick={() => setAlert(null)}>Dismiss</button>
                </div>
              </div>
            )}
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(1)].map((_, i) => (
                  <div key={i} className="rounded-lg border border-border overflow-hidden bg-card">
                    <div className="flex items-center gap-3 bg-secondary/50 px-4 py-3 border-b border-border">
                      <Skeleton className="h-4 w-4 rounded bg-slate-300" />
                      <Skeleton className="h-4 w-32 bg-slate-300" />
                      <Skeleton className="h-5 w-16 ml-auto rounded-full bg-slate-300" />
                    </div>
                  </div>
                ))}
              </div>
            ):(
              <>
                {groupedByPredictionMonth.map((monthGroup) => {
                  const monthKey = `comp-${monthGroup.year}-${monthGroup.month}`
                  const isMonthOpen = expandedMonths.has(monthKey)
                  const page = currentPage[monthKey] || 0
                  const totalPages = Math.ceil(monthGroup.rows.length / ROWS_PER_PAGE)
                  const totals = getTotals(monthGroup.rows)
                  const pageRows = monthGroup.rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)

                  const displayRows = (() => {
                    const display: React.ReactNode[] = []

                    const recoByRow = new Map<string, AIRecommendations>()
                    recos.forEach((r) => {
                      if (r.original_row_id) {
                        recoByRow.set(r.original_row_id, r)
                      }
                    })

                    const rowsByCustomer = new Map<string, GrossProfitRow[]>()
                    pageRows.forEach((r) => {
                      if (!rowsByCustomer.has(r.customer_name)) {
                        rowsByCustomer.set(r.customer_name, [])
                      }
                      rowsByCustomer.get(r.customer_name)!.push(r)
                    })

                    let customerIdx = 0
                    rowsByCustomer.forEach((customerRows, customer) => {
                      const totalRowsForCustomer = customerRows.reduce((sum, row) => {
                        return sum + (recoByRow.has(row.id) ? 1 : 0)
                      }, 0)

                      customerRows.forEach((row, rowIdx) => {
                        const reco = recoByRow.get(row.id) as any | undefined
                        const isUpdating = updatingIds.has(row.id)

                        // AI suggestion row, if available
                        if (reco) {
                          display.push(
                            <tr
                              key={`ai-${customerIdx}-${rowIdx}`}
                              className={`border-b border-border bg-primary/5 hover:bg-primary/10 transition-opacity ${isUpdating ? "opacity-60 pointer-events-none" : ""}`}
                            >
                              {rowIdx === 0 && (
                                <td
                                  rowSpan={totalRowsForCustomer}
                                  className="text-xs font-semibold text-foreground p-2 border-r border-border align-middle text-center bg-card/80 break-words max-w-[80px]"
                                >
                                  {customer}
                                </td>
                              )}
                              <td className="p-2 border-r border-border">
                                {isUpdating ? <LoadingDots /> : (
                                  <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                    AI Suggestion
                                  </span>
                                )}
                              </td>
                              <td className="text-xs text-foreground font-medium p-2 border-r border-border">{isUpdating ? <LoadingDots /> : reco.product_spec}</td>
                              {isUpdating ? <LoadingDots /> : (
                                <Input type="number" defaultValue={reco.suggested_quantity} className="text-xs font-mono text-right p-2 border-r border-border text-primary"
                                  //onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v) && v !== reco.suggested_quantity) updateAISuggestion(row.id, { suggested_quantity: v, suggested_amount_sales: reco.suggested_amount_sales, suggested_freight_cost: reco.suggested_freight_cost, suggested_cogs: reco.suggested_cogs, predicted_net_sales: reco.predicted_net_sales,  predicted_gm_value: reco.predicted_gm_value }, reco) }} 
                                  onBlur={(e) => { 
                                    const v = parseFloat(e.currentTarget.value); 
                                    if (!isNaN(v) && v !== reco.suggested_quantity) {
                                      updateAISuggestion(row.id, { ...reco, suggested_quantity: v });
                                    }
                                  }}
                                />
                              )}
                              {/* <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_quantity)}</td> */}
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_amount_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_freight_cost)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_cogs)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.predicted_net_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.predicted_gm_value)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">
                                {isUpdating ? <LoadingDots /> : (
                                  <span className={reco.predicted_gm_percent && reco.predicted_gm_percent < 0 ? "text-red-500 font-semibold" : "text-accent font-semibold"}>
                                    {formatPercent(reco.predicted_gm_percent)}
                                  </span>
                                )}
                              </td>
                              <td className="text-xs text-center p-2 border-r border-border">
                                {isUpdating ? <LoadingDots /> : (
                                  <Badge className={`px-2 py-0.5 text-[10px] ${
                                    reco.action === "BOOST" ? "bg-green-600/10 text-green-600" :
                                    reco.action === "INTRODUCE" ? "bg-blue-600/10 text-blue-600" :
                                    reco.action === "MAINTAIN" ? "bg-orange-500/10 text-orange-500" :
                                    reco.action === "REDUCE" ? "bg-yellow-600/10 text-yellow-600" :
                                    "bg-red-600/10 text-red-600"
                                  }`}>
                                    {reco.action}
                                  </Badge>
                                )}
                              </td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{isUpdating ? <LoadingDots /> : formatConfidence(reco.confidence_score)}</td>
                              <td className="text-xs text-muted-foreground p-2 border-r border-border">{isUpdating ? <LoadingDots /> : reco.replaced_from ?? "—"}</td>
                              <td className="text-xs p-2 break-words min-w-[260px] text-muted-foreground italic">{isUpdating ? <LoadingDots /> : reco.reason ?? "—"}</td>
                            </tr>
                          )
                        }
                      })

                      // Subtotal row per customer
                      // if (customerRows.length > 0) {
                      //   const subtotal = customerRows.reduce(
                      //     (acc, row) => {
                      //       acc.quantity += row.quantity || 0
                      //       acc.amount_sales += row.amount_sales || 0
                      //       acc.freight_cost += row.freight_cost || 0
                      //       acc.cogs += row.cogs || 0
                      //       acc.net_sales += row.net_sales || 0
                      //       acc.gross_margin_value += row.gross_margin_value || 0
                      //       return acc
                      //     },
                      //     { quantity: 0, amount_sales: 0, freight_cost: 0, cogs: 0, net_sales: 0, gross_margin_value: 0 }
                      //   )
                      //   const subtotalNetSales = subtotal.amount_sales - subtotal.freight_cost
                      //   const subtotalGMValue = subtotalNetSales - subtotal.cogs
                      //   const subtotalGMPercent = subtotalNetSales !== 0 ? subtotalGMValue / subtotalNetSales : 0

                      //   display.push(
                      //     <tr key={`subtotal-${customerIdx}`} className="bg-secondary/20 border-t-2 border-border font-semibold">
                      //       <td colSpan={3} className="text-xs font-semibold text-foreground p-2 border-r border-border">ACTUAL SUBTOTAL</td>
                      //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.quantity)}</td>
                      //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.amount_sales)}</td>
                      //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.freight_cost)}</td>
                      //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.cogs)}</td>
                      //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotalNetSales)}</td>
                      //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotalGMValue)}</td>
                      //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatPercent(subtotalGMPercent)}</td>
                      //       <td colSpan={4}></td>
                      //     </tr>
                      //   )
                      // }

                      // Subtotal row per customer AI (using AI suggestion fields)
                      if (customerRows.length > 0) {
                        // Find all AI recommendations for this customer
                        const aiRecos = customerRows
                          .map(row => recoByRow.get(row.id))
                          .filter(r => r);
                        if (aiRecos.length > 0) {
                          const subtotal = aiRecos.reduce(
                            (acc, reco) => {
                              acc.suggested_quantity += reco.suggested_quantity || 0;
                              acc.suggested_amount_sales += reco.suggested_amount_sales || 0;
                              acc.suggested_freight_cost += reco.suggested_freight_cost || 0;
                              acc.suggested_cogs += reco.suggested_cogs || 0;
                              return acc;
                            },
                            { suggested_quantity: 0, suggested_amount_sales: 0, suggested_freight_cost: 0, suggested_cogs: 0 }
                          );
                          const subtotalNetSales = subtotal.suggested_amount_sales - subtotal.suggested_freight_cost;
                          const subtotalGMValue = subtotalNetSales - subtotal.suggested_cogs;
                          const subtotalGMPercent = subtotalNetSales !== 0 ? subtotalGMValue / subtotalNetSales : 0;

                          display.push(
                            <tr key={`ai-subtotal-${customerIdx}`} className="bg-primary/10 border-t-2 border-primary/10 font-semibold">
                              <td colSpan={3} className="text-xs font-semibold text-primary p-2 border-r border-border">AI SUBTOTAL</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_quantity)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_amount_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_freight_cost)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_cogs)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotalNetSales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotalGMValue)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border font-semibold text-accent">{formatPercent(subtotalGMPercent)}</td>
                              <td colSpan={4}></td>
                            </tr>
                          );
                        }
                      }
                      

                      // Spacer between customers
                      if (customerIdx < rowsByCustomer.size - 1) {
                        display.push(
                          <tr key={`spacer-${customerIdx}`} className="border-t-2 border-primary/60">
                            <td colSpan={14} />
                          </tr>
                        )
                      }

                      customerIdx++
                    })

                    return display
                  })()

                  return (
                    <div key={monthKey} className="rounded-lg border border-border overflow-hidden bg-card flex flex-col">
                      <button
                        onClick={() => toggleMonth(monthKey)}
                        className="w-full flex items-center gap-3 bg-secondary/50 hover:bg-secondary/70 px-4 py-3 border-b border-border transition-colors"
                      >
                        {isMonthOpen ? (
                          <ChevronDown className="h-4 w-4 text-primary" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-semibold text-foreground">{formatMonthYear(monthGroup.month, monthGroup.year)}</span>
                        <Badge variant="secondary" className="ml-auto text-xs font-mono">
                          {monthGroup.rows.length} rows
                        </Badge>
                      </button>

                      {!isMonthOpen && <div className="px-4 py-2 text-xs text-muted-foreground/50">Click to expand</div>}

                      {isMonthOpen && (
                        <div className="max-h-[600px] overflow-y-auto overflow-x-auto scrollbar-hide">
                          <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-card border-b border-border">
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Customer</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Type</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Product</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Qty</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Sales</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Freight</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">COGS</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Net Sales</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">GM Val</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">GM %</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-center p-2 border-r border-border">Action</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Confidence</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Replaced From</th>
                                <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayRows}
                            </tbody>
                            {monthGroup.rows.length > 0 && (
                              <tfoot>
                                <tr className="sticky bottom-0 z-20 bg-card border-b border-border font-semibold">
                                  <td colSpan={3} className="text-xs font-semibold text-foreground p-2 border-r border-border">TOTAL</td>
                                  <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.quantity)}</td>
                                  <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales)}</td>
                                  <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.freight_cost)}</td>
                                  <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.cogs)}</td>
                                  <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales - totals.freight_cost)}</td>
                                  <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber((totals.amount_sales - totals.freight_cost) - totals.cogs)}</td>
                                  <td className="text-xs font-mono text-right p-2 border-r border-border">{formatPercent(((totals.amount_sales - totals.freight_cost) - totals.cogs) / (totals.amount_sales - totals.freight_cost))}</td>
                                  <td colSpan={4}></td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      )}

                      {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 border-t border-border p-3 bg-card/50">
                          <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.max(0, page - 1) })} disabled={page === 0}>
                            Prev
                          </Button>
                          <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
                          <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.min(totalPages - 1, page + 1) })} disabled={page === totalPages - 1}>
                            Next
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </TabsContent>
        )}

        {/* AI TAB NEW */}
        {activeTab === "ai1" && (
          <TabsContent value="ai1" className="mt-3 space-y-3 w-full">
            {isAiLoading ? (
              <div className="p-10 flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="animate-spin h-6 w-6" />
                <span className="text-sm">Generating AI strategies...</span>
              </div>
            ) : aiError ? (
              <div className="flex flex-col items-center gap-4 p-10 border-2 border-dashed border-destructive/30 rounded-xl">
                <p className="text-sm text-destructive">{aiError}</p>
                <Button variant="outline" size="sm" onClick={fetchAiStrategies} className="gap-2">
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </Button>
              </div>
            ) : (
              <CustomerStrategyCarousel data={aiStrategies} />
            )}
          </TabsContent>
        )}
        {/* Original Tab */}
        {activeTab === "original" && (
          <TabsContent value="original" className="mt-6 space-y-6">
            {groupedByMonth.map((monthGroup) => {
              const monthKey = `orig-${monthGroup.year}-${monthGroup.month}`
              const isMonthOpen = expandedMonths.has(monthKey)
              const page = currentPage[monthKey] || 0
              const totalPages = Math.ceil(monthGroup.rows.length / ROWS_PER_PAGE)
              const displayRows = getDisplayRows(monthGroup.rows, page)
              const totals = getTotals(monthGroup.rows)

              return (
                <div key={monthKey} className="rounded-lg border border-border overflow-hidden bg-card flex flex-col">
                  <button onClick={() => toggleMonth(monthKey)} className="w-full flex items-center gap-3 bg-secondary/50 hover:bg-secondary/70 px-4 py-3 border-b border-border transition-colors">
                    {isMonthOpen ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-semibold text-foreground">{formatMonthYear(monthGroup.month, monthGroup.year)}</span>
                    <Badge variant="secondary" className="ml-auto text-xs font-mono">{monthGroup.rows.length} rows</Badge>
                  </button>

                  {!isMonthOpen && <div className="px-4 py-2 text-xs text-muted-foreground/50">Click to expand</div>}

                  {isMonthOpen && (
                    <div className="max-h-[600px] overflow-y-auto overflow-x-auto scrollbar-hide">
                      <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-secondary border-b border-border">
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-left p-2 border-r border-border">Customer</th>
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-left p-2 border-r border-border">Product</th>
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">Qty</th>
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">Sales</th>
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">Freight</th>
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">Net Sales</th>
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">COGS</th>
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">GM Val</th>
                            <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.map((row, idx) => (
                            <tr key={row.id} className={`border-b border-border hover:bg-secondary/10 ${idx % 2 === 0 ? "bg-card" : "bg-card/50"}`}>
                              {row.isFirstOfCustomer && <td rowSpan={row.rowSpan} className="text-xs font-medium text-foreground p-2 border-r border-border align-top">{row.customer_name}</td>}
                              <td className="text-xs p-2 border-r border-border">
                                <input type="text" defaultValue={row.product_spec} className="w-20 bg-transparent text-xs py-1"
                                  onBlur={(e) => { const val = e.currentTarget.value.trim(); if (val && val !== row.product_spec) updateRowField(row.id, { product_spec: val }) }} />
                              </td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">
                                {updatingIds.has(row.id) ? <LoadingDots /> : (
                                  <input
                                    type="number"
                                    defaultValue={row.quantity}
                                    className="w-12 bg-transparent text-right text-xs py-1"
                                    onBlur={(e) => {
                                      const v = parseFloat(e.currentTarget.value)
                                      if (!isNaN(v) && v !== row.quantity) updateRowField(row.id, { quantity: v })
                                    }}
                                    onKeyUp={(e) => {
                                      const v = parseFloat(e.currentTarget.value)
                                      if (!isNaN(v) && v !== row.quantity) {
                                        if (qtyInputTimer.current) {
                                          try { window.clearTimeout(qtyInputTimer.current) } catch {}
                                        }
                                        qtyInputTimer.current = window.setTimeout(() => {
                                          updateRowField(row.id, { quantity: v })
                                        }, 800)
                                      }
                                    }}
                                  />
                                )}
                              </td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.amount_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.freight_cost)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.net_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.cogs)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.gross_margin_value)}</td>
                              <td className="text-xs p-2">
                                {row.status === "formula_mismatch"
                                  ? <Badge variant="destructive" className="text-[8px] px-1 py-0 h-4">Mismatch</Badge>
                                  : <Badge className="text-[8px] px-1 py-0 h-4 bg-accent/15 text-accent">OK</Badge>}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-secondary/20 border-t-2 border-border font-semibold">
                            <td colSpan={2} className="text-xs font-semibold text-foreground border-r border-border">TOTAL</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.quantity)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.freight_cost)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.net_sales)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.cogs)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.gross_margin_value)}</td>
                            <td colSpan={2}></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {isMonthOpen && totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 border-t border-border p-3 bg-card/50">
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.max(0, page - 1) })} disabled={page === 0}>Prev</Button>
                      <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.min(totalPages - 1, page + 1) })} disabled={page === totalPages - 1}>Next</Button>
                    </div>
                  )}
                </div>
              )
            })}
          </TabsContent>
        )}

        {/* Comparison Tab */}
        {activeTab === "comparison" && hasRecommendations && (
          <TabsContent value="comparison" className="mt-3 space-y-3">
            {/* Prediction Period Button Group */}
            {/* <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-muted-foreground">Prediction Period:</span>
              <ButtonGroup aria-label="Button group">
              {[...Array(12)].map((_, idx) => (
               
                  <Button key={idx + 1}
                  className="rounded border border-border bg-secondary text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                  onClick={() => sendPredictionPeriod(idx + 1)}>
                    {idx + 1}
                  </Button>
              ))}
              
              </ButtonGroup>
            </div> */}
            {/* Alert for success/error */}
            {alert && (
              <div className={`my-2`}>
                <div className={`flex items-center gap-2 px-4 py-2 rounded border ${alert.type === 'success' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
                  <span className="font-semibold">{alert.type === 'success' ? 'Success:' : 'Error:'}</span>
                  <span>{alert.message}</span>
                  <button className="ml-auto text-xs underline" onClick={() => setAlert(null)}>Dismiss</button>
                </div>
              </div>
            )}
            {groupedByMonth.map((monthGroup) => {
              const monthKey = `comp-${monthGroup.year}-${monthGroup.month}`
              const isMonthOpen = expandedMonths.has(monthKey)
              const page = currentPage[monthKey] || 0
              const totalPages = Math.ceil(monthGroup.rows.length / ROWS_PER_PAGE)
              const totals = getTotals(monthGroup.rows)
              const pageRows = monthGroup.rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)

              const displayRows = (() => {
                const display: React.ReactNode[] = []

                const recoByRow = new Map<string, AIRecommendation>()
                recos.forEach((r) => {
                  if (r.original_row_id) {
                    recoByRow.set(r.original_row_id, r)
                  }
                })

                const rowsByCustomer = new Map<string, GrossProfitRow[]>()
                pageRows.forEach((r) => {
                  if (!rowsByCustomer.has(r.customer_name)) {
                    rowsByCustomer.set(r.customer_name, [])
                  }
                  rowsByCustomer.get(r.customer_name)!.push(r)
                })

                let customerIdx = 0
                rowsByCustomer.forEach((customerRows, customer) => {
                  const totalRowsForCustomer = customerRows.reduce((sum, row) => {
                    return sum + 1 + (recoByRow.has(row.id) ? 1 : 0)
                  }, 0)

                  customerRows.forEach((row, rowIdx) => {
                    const reco = recoByRow.get(row.id) as any | undefined
                    const isUpdating = updatingIds.has(row.id)

                    // Actual data row
                    display.push(
                      <tr
                        key={`actual-${customerIdx}-${rowIdx}`}
                        className={`border-b border-border hover:bg-secondary/10 bg-card transition-opacity ${isUpdating ? "opacity-60 pointer-events-none" : ""}`}
                      >
                        {rowIdx === 0 && (
                          <td
                            rowSpan={totalRowsForCustomer}
                            className="text-xs font-semibold text-foreground p-2 border-r border-border align-middle text-center bg-card/80 break-words max-w-[80px]"
                          >
                            {customer}
                          </td>
                        )}
                        <td className="p-2 border-r border-border">
                          {isUpdating ? <LoadingDots /> : (
                            <span className="text-[10px] font-medium text-muted-foreground bg-secondary/30 px-1.5 py-0.5 rounded">
                              Actual
                            </span>
                          )}
                        </td>
                        <td className="text-xs text-foreground font-medium p-2 border-r border-border">
                          {isUpdating ? <LoadingDots /> : row.product_spec}
                        </td>
                        {/* <td className="text-xs font-mono text-right p-2 border-r border-border">
                          {isUpdating ? <LoadingDots /> : (
                            <input type="number" defaultValue={row.quantity} className="w-12 bg-transparent text-right text-xs py-1"
                              onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v) && v !== row.quantity) updateRowField(row.id, { quantity: v }) }} />
                          )}
                        </td> */}
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.quantity)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.amount_sales)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.freight_cost)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.cogs)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.net_sales)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.gross_margin_value)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">
                          {isUpdating ? <LoadingDots /> : (
                            <span className={row.gross_margin_percent && row.gross_margin_percent < 0 ? "text-red-500 font-semibold" : "text-green-600 font-semibold"}>
                              {formatPercent(row.gross_margin_percent)}
                            </span>
                          )}
                        </td>
                        {/* empty cells to line up with AI columns */}
                        <td className="p-2 border-r border-border" />
                        <td className="p-2 border-r border-border" />
                        <td className="p-2 border-r border-border" />
                        <td className="p-2" />
                      </tr>
                    )

                    // AI suggestion row, if available
                    if (reco) {
                      display.push(
                        <tr
                          key={`ai-${customerIdx}-${rowIdx}`}
                          className={`border-b border-border bg-primary/18 hover:bg-primary/10 transition-opacity ${isUpdating ? "opacity-60 pointer-events-none" : ""}`}
                        >
                          <td className="p-2 border-r border-border">
                            {isUpdating ? <LoadingDots /> : (
                              <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                AI Suggestion
                              </span>
                            )}
                          </td>
                          <td className="text-xs text-foreground font-medium p-2 border-r border-border">{isUpdating ? <LoadingDots /> : reco.product_spec}</td>
                          {isUpdating ? <LoadingDots /> : (
                            <Input type="number" defaultValue={reco.suggested_quantity} className="text-xs font-mono text-right p-2 border-r border-border text-primary"
                              //onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v) && v !== reco.suggested_quantity) updateAISuggestion(row.id, { suggested_quantity: v, suggested_amount_sales: reco.suggested_amount_sales, suggested_freight_cost: reco.suggested_freight_cost, suggested_cogs: reco.suggested_cogs, predicted_net_sales: reco.predicted_net_sales,  predicted_gm_value: reco.predicted_gm_value }, reco) }} 
                              onBlur={(e) => { 
                                const v = parseFloat(e.currentTarget.value); 
                                if (!isNaN(v) && v !== reco.suggested_quantity) {
                                  updateAISuggestion(row.id, { ...reco, suggested_quantity: v });
                                }
                              }}
                            />
                          )}
                          {/* <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_quantity)}</td> */}
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_amount_sales)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_freight_cost)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_cogs)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.predicted_net_sales)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.predicted_gm_value)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border">
                            {isUpdating ? <LoadingDots /> : (
                              <span className={reco.predicted_gm_percent && reco.predicted_gm_percent < 0 ? "text-red-500 font-semibold" : "text-accent font-semibold"}>
                                {formatPercent(reco.predicted_gm_percent)}
                              </span>
                            )}
                          </td>
                          <td className="text-xs text-center p-2 border-r border-border">
                            {isUpdating ? <LoadingDots /> : (
                              <Badge className={`px-2 py-0.5 text-[10px] ${
                                reco.action === "BOOST" ? "bg-green-600/10 text-green-600" :
                                reco.action === "SUBTITUDE" ? "bg-blue-600/10 text-blue-600" :
                                reco.action === "MAINTAIN" ? "bg-orange-500/10 text-orange-500" :
                                reco.action === "REDUCE" ? "bg-yellow-600/10 text-yellow-600" :
                                "bg-red-600/10 text-red-600"
                              }`}>
                                {reco.action}
                              </Badge>
                            )}
                          </td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{isUpdating ? <LoadingDots /> : formatConfidence(reco.confidence_score)}</td>
                          <td className="text-xs text-muted-foreground p-2 border-r border-border">{isUpdating ? <LoadingDots /> : reco.replaced_from ?? "—"}</td>
                          <td className="text-xs p-2 break-words min-w-[260px] text-muted-foreground italic">{isUpdating ? <LoadingDots /> : reco.reason ?? "—"}</td>
                        </tr>
                      )
                    }
                  })

                  // Subtotal row per customer
                  if (customerRows.length > 0) {
                    const subtotal = customerRows.reduce(
                      (acc, row) => {
                        acc.quantity += row.quantity || 0
                        acc.amount_sales += row.amount_sales || 0
                        acc.freight_cost += row.freight_cost || 0
                        acc.cogs += row.cogs || 0
                        acc.net_sales += row.net_sales || 0
                        acc.gross_margin_value += row.gross_margin_value || 0
                        return acc
                      },
                      { quantity: 0, amount_sales: 0, freight_cost: 0, cogs: 0, net_sales: 0, gross_margin_value: 0 }
                    )
                    const subtotalNetSales = subtotal.amount_sales - subtotal.freight_cost
                    const subtotalGMValue = subtotalNetSales - subtotal.cogs
                    const subtotalGMPercent = subtotalNetSales !== 0 ? subtotalGMValue / subtotalNetSales : 0

                    display.push(
                      <tr key={`subtotal-${customerIdx}`} className="bg-secondary/20 border-t-2 border-border font-semibold">
                        <td colSpan={3} className="text-xs font-semibold text-foreground p-2 border-r border-border">ACTUAL SUBTOTAL</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.quantity)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.amount_sales)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.freight_cost)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.cogs)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotalNetSales)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotalGMValue)}</td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border">{formatPercent(subtotalGMPercent)}</td>
                        <td colSpan={4}></td>
                      </tr>
                    )
                  }

                  // Subtotal row per customer AI (using AI suggestion fields)
                  if (customerRows.length > 0) {
                    // Find all AI recommendations for this customer
                    const aiRecos = customerRows
                      .map(row => recoByRow.get(row.id))
                      .filter(r => r);
                    if (aiRecos.length > 0) {
                      const subtotal = aiRecos.reduce(
                        (acc, reco) => {
                          acc.suggested_quantity += reco.suggested_quantity || 0;
                          acc.suggested_amount_sales += reco.suggested_amount_sales || 0;
                          acc.suggested_freight_cost += reco.suggested_freight_cost || 0;
                          acc.suggested_cogs += reco.suggested_cogs || 0;
                          return acc;
                        },
                        { suggested_quantity: 0, suggested_amount_sales: 0, suggested_freight_cost: 0, suggested_cogs: 0 }
                      );
                      const subtotalNetSales = subtotal.suggested_amount_sales - subtotal.suggested_freight_cost;
                      const subtotalGMValue = subtotalNetSales - subtotal.suggested_cogs;
                      const subtotalGMPercent = subtotalNetSales !== 0 ? subtotalGMValue / subtotalNetSales : 0;

                      display.push(
                        <tr key={`ai-subtotal-${customerIdx}`} className="bg-primary/10 border-t-2 border-primary/40 font-semibold">
                          <td colSpan={3} className="text-xs font-semibold text-primary p-2 border-r border-border">AI SUBTOTAL</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_quantity)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_amount_sales)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_freight_cost)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_cogs)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotalNetSales)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotalGMValue)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border font-semibold text-accent">{formatPercent(subtotalGMPercent)}</td>
                          <td colSpan={4}></td>
                        </tr>
                      );
                    }
                  }
                  

                  // Spacer between customers
                  if (customerIdx < rowsByCustomer.size - 1) {
                    display.push(
                      <tr key={`spacer-${customerIdx}`} className="border-t-2 border-primary/60">
                        <td colSpan={14} />
                      </tr>
                    )
                  }

                  customerIdx++
                })

                return display
              })()

              return (
                <div key={monthKey} className="rounded-lg border border-border overflow-hidden bg-card flex flex-col">
                  <button
                    onClick={() => toggleMonth(monthKey)}
                    className="w-full flex items-center gap-3 bg-secondary/50 hover:bg-secondary/70 px-4 py-3 border-b border-border transition-colors"
                  >
                    {isMonthOpen ? (
                      <ChevronDown className="h-4 w-4 text-primary" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-semibold text-foreground">{formatMonthYear(monthGroup.month, monthGroup.year)}</span>
                    <Badge variant="secondary" className="ml-auto text-xs font-mono">
                      {monthGroup.rows.length} rows
                    </Badge>
                  </button>

                  {!isMonthOpen && <div className="px-4 py-2 text-xs text-muted-foreground/50">Click to expand</div>}

                  {isMonthOpen && (
                    <div className="max-h-[600px] overflow-y-auto overflow-x-auto scrollbar-hide">
                      <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-card border-b border-border">
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Customer</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Type</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Product</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Qty</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Sales</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Freight</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">COGS</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Net Sales</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">GM Val</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">GM %</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-center p-2 border-r border-border">Action</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Confidence</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Replaced From</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows}
                        </tbody>
                        {monthGroup.rows.length > 0 && (
                          <tfoot>
                            <tr className="sticky bottom-0 z-20 bg-card border-b border-border font-semibold">
                              <td colSpan={3} className="text-xs font-semibold text-foreground p-2 border-r border-border">TOTAL</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.quantity)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.freight_cost)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.cogs)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales - totals.freight_cost)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber((totals.amount_sales - totals.freight_cost) - totals.cogs)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{formatPercent(((totals.amount_sales - totals.freight_cost) - totals.cogs) / (totals.amount_sales - totals.freight_cost))}</td>
                              <td colSpan={4}></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}

                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 border-t border-border p-3 bg-card/50">
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.max(0, page - 1) })} disabled={page === 0}>
                        Prev
                      </Button>
                      <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.min(totalPages - 1, page + 1) })} disabled={page === totalPages - 1}>
                        Next
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

// "use client"

// import React, { useState, useMemo, useRef, useEffect, useCallback } from "react"
// import { useRouter } from "next/navigation"
// import { Badge } from "@/components/ui/badge"
// import { Button } from "@/components/ui/button"
// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
// import { Skeleton } from "@/components/ui/skeleton"
// import { RefreshCw, Clock, Layers, Zap, ArrowLeftRight, ChevronDown, ChevronRight, File, Loader2 } from "lucide-react"
// import type { GrossProfitRow, AIRecommendation } from "@/lib/database.types"
// import { Input } from "../ui/input"
// import {   ButtonGroup, ButtonGroupSeparator, ButtonGroupText, } from "../ui/button-group"
// import { toast } from "sonner"
// import { AIRecommendations } from "@/lib/n8n-webhook-ai-suggestion"
// import { CustomerStrategy, CustomerStrategyCarousel } from "../suggestion-card/suggestion-card"
// import { set } from "date-fns"



// // Simple virtual scrolling hook - renders only visible items
// function useVirtualScroll(items: number, itemHeight: number, containerHeight: number, scrollTop: number) {
//   const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 1)
//   const endIndex = Math.min(items, Math.ceil((scrollTop + containerHeight) / itemHeight) + 1)
//   const offsetY = startIndex * itemHeight
//   return { startIndex, endIndex, offsetY, visibleCount: endIndex - startIndex }
// }

// function formatNumber(value: number | null | undefined): string {
//   if (value === null || value === undefined) return "—"
//   return new Intl.NumberFormat("en-US", {
//     minimumFractionDigits: 0,
//     maximumFractionDigits: 2,
//   }).format(value)
// }

// function formatPercent(value: number | null | undefined): string {
//   if (value === null || value === undefined) return "—"
//   const display = value > 1 ? value : value * 100
//   return `${display.toFixed(1)}%`
// }

// function formatConfidence(value: number | null | undefined): string {
//   if (value === null || value === undefined) return "—"
//   return value.toFixed(4)
// }

// function formatMonthYear(month: number | null | undefined, year: number | null | undefined): string {
//   if (!month || !year) return "Unknown"
//   return new Date(year, month - 1).toLocaleString("default", { month: "long", year: "numeric" })
// }

// interface ComparisonViewProps {
//   uploadId: string
//   rows: GrossProfitRow[]
//   recommendations: AIRecommendation[]
// }

// const ROWS_PER_PAGE = 15

// type RowWithSpan = GrossProfitRow & { rowSpan?: number; isFirstOfCustomer?: boolean }

// export function ComparisonView({ uploadId, rows, recommendations }: ComparisonViewProps) {
//   const router = useRouter()
//   const [recos, setRecos] = useState<AIRecommendation[]>(recommendations)
//   const hasRecommendations = recos.length > 0
//   const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
//   const [currentPage, setCurrentPage] = useState<Record<string, number>>({})
//   const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
//   const [activeTab, setActiveTab] = useState("comparison")
//   const [scrollPositions, setScrollPositions] = useState<Record<string, number>>({})
//   const qtyTriggerTimer = useRef<number | null>(null)
//   const qtyInputTimer = useRef<number | null>(null)
//   const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({})
//   const [isLoading, setLoading] = useState(false);
//   const [isAiLoading, setIsAiLoading] = useState(false);
//   const [hasAiFetched, setHasAiFetched] = useState(false);
//   const [aiStrategies, setAiStrategies] = useState<CustomerStrategy[]>([]);
  
//   useEffect(() => {
//     setRecos(recommendations)
//   }, [recommendations])

//   async function fetchRecommendations() {
//     try {
//       const resp = await fetch(`/api/recommendations?upload_id=${uploadId}`)
//       if (!resp.ok) return
//       const data = await resp.json()
//       if (data.success) {
//         setRecos(data.recommendations || [])
//       }

//     } catch (e) {
//       console.error("Error fetching recommendations", e)
//       toast.error("Failed to fetch recommendations")
//     }
//   }

//   async function fetchAiStrategies() {
//     setIsAiLoading(true);
//     try {
//       // 2. Trigger n8n for AI Reasoning & Product Mix Strategy
//       // We pass the baseRecos to n8n so the Python script can process them
//       const aiResponse = await fetch("http://10.100.17.2:5678/webhook-test/python-simulator", {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/json' },
//       });
//       if (aiResponse.ok) {
//           const aiData = await aiResponse.json();
          
//           const cleanData = aiData[0]?.recommendations || [];
//           // aiData.results should be the aggregated array from n8n 
//           // containing customerId, mixStrategy, and ai_reasoning
//           setAiStrategies(cleanData); 
//           setHasAiFetched(true);
//           toast.success("AI Strategy generated successfully!");
//           console.log(aiStrategies, "AI Data received from n8n:", aiData);
//       }
//     } catch (error) {
      
//       console.error("Error fetching recommendations", error)
//       toast.error("Failed to fetch recommendations")
//     } 
//     finally {
//       setIsAiLoading(false);
//     }
    
//   }

//   useEffect(() => {
//     fetchRecommendations()
//     fetchAiStrategies()
//   }, [uploadId])

//   function toggleMonth(key: string) {
//     const next = new Set(expandedMonths)
//     if (next.has(key)) next.delete(key)
//     else next.add(key)
//     setExpandedMonths(next)
//   }

//   const recoByRowIdForSort = useMemo(() => {
//     const m = new Map<string, string>()
//     recos.forEach((r) => {
//       if (r.original_row_id) m.set(r.original_row_id as string, r.action || "")
//     })
//     return m
//   }, [recos])

//   const groupedByMonth = useMemo(() => {
//     const groups = new Map<string, { month: number; year: number; rows: GrossProfitRow[] }>()
//     for (const r of rows) {
//       const month = r.sheet_month || 0
//       const year = r.sheet_year || 0
//       const key = `${year}-${month}`
//       if (!groups.has(key)) groups.set(key, { month, year, rows: [] })
//       groups.get(key)!.rows.push(r)
//     }
//     return Array.from(groups.values())
//       .sort((a, b) => (b.year - a.year) || (b.month - a.month))
//       .map((g) => {
//         g.rows.sort((a, b) => {
//           if (a.customer_name !== b.customer_name) return a.customer_name.localeCompare(b.customer_name)
//           const order: Record<string, number> = { BOOST: 0, REDUCE: 1, REPLACE: 2 }
//           const oa = recoByRowIdForSort.get(a.id)
//           const ob = recoByRowIdForSort.get(b.id)
//           if (oa && ob && oa !== ob) return (order[oa] ?? 3) - (order[ob] ?? 3)
//           return (a.product_spec || "").localeCompare(b.product_spec || "")
//         })
//         return g
//       })
//   }, [rows, recoByRowIdForSort])

//   const groupedByPredictionMonth = useMemo(() => {
//   // Build a map from row id -> prediction month/year via recos
//   const rowToPrediction = new Map<string, { month: number; year: number }>()
//   recos.forEach((r) => {
//     if (r.original_row_id && r.prediction_month && r.prediction_year) {
//       rowToPrediction.set(r.original_row_id, {
//         month: r.prediction_month,
//         year: r.prediction_year,
//       })
//     }
//   })

//   const groups = new Map<string, { month: number; year: number; rows: GrossProfitRow[] }>()
//   for (const r of rows) {
//     const pred = rowToPrediction.get(r.id)

//     if (!pred) continue

//     const month = pred?.month || r.sheet_month || 0
//     const year = pred?.year || r.sheet_year || 0
//     const key = `${year}-${month}`
//     if (!groups.has(key)) groups.set(key, { month, year, rows: [] })
//     groups.get(key)!.rows.push(r)
//   }

//   return Array.from(groups.values())
//     .sort((a, b) => (b.year - a.year) || (b.month - a.month))
//     .map((g) => {
//       g.rows.sort((a, b) => {
//         if (a.customer_name !== b.customer_name) return a.customer_name.localeCompare(b.customer_name)
//         const order: Record<string, number> = { BOOST: 0, REDUCE: 1, REPLACE: 2 }
//         const oa = recoByRowIdForSort.get(a.id)
//         const ob = recoByRowIdForSort.get(b.id)
//         if (oa && ob && oa !== ob) return (order[oa] ?? 3) - (order[ob] ?? 3)
//         return (a.product_spec || "").localeCompare(b.product_spec || "")
//       })
//       return g
//     })
// }, [rows, recos, recoByRowIdForSort])

//   // State for alert dialog
//   const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

//   // Function to send prediction period to webhook
//   async function sendPredictionPeriod(period: number) {
//   setLoading(true)
//     try {
//       const res = await fetch('/api/trigger-predictions-period', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ upload_id: uploadId, period, action: 'period_trigger' }),
//       });

//       const data = await res.json();

//       console.log('res.status:', res.status)
//       console.log('res.ok:', res.ok)
//       console.log('data:', data)
//       if (!res.ok) throw new Error(data.error || 'Failed to send period');
      
//       setAlert({ type: 'success', message: `Prediction period ${period} sent successfully!` });
//       toast.success(`Prediction period ${period} sent successfully!`);
//     } catch (e: any) {
//       setAlert({ type: 'error', message: e?.message || 'Failed to send prediction period.' });
//       toast.error(`Failed to send prediction period: ${e?.message || 'Unknown error'}`);
//     } finally {
//       setLoading(false)
//     }
//   }
//   // async function sendPredictionPeriod(period: number) {
//   //   setLoading(true);
//   //   try {
//   //     const res = await fetch('/api/trigger-predictions-period', {
//   //       method: 'POST',
//   //       headers: { 'Content-Type': 'application/json' },
//   //       body: JSON.stringify({ upload_id: uploadId, period, action: 'period_trigger' }),
//   //     });

//   //     const data = await res.json();
//   //     if (!res.ok) throw new Error(data.error || 'Failed to send period');
//   //     setAlert({ type: 'success', message: `Prediction period ${period} sent successfully!` });
//   //     toast.success(`Prediction period ${period} successfully!`);
//   //   } catch (e) {
//   //     setLoading(false);
//   //     console.log('console: ', e)
//   //     setAlert({ type: 'error', message: e?.message || 'Failed to send prediction period.' });
//   //     toast.error(`Failed to send prediction period: ${e?.message || 'Unknown error'}`);
//   //   } 
//   //     setLoading(false);
//   // }
//   async function updateRowField(rowId: string, updates: Record<string, any>) {
//     setUpdatingIds((prev) => new Set(prev).add(rowId))
//     console.log("updateRowField called with:", { rowId, uploadId, updates })
//     try {
//       const payload = { rowId, upload_id: uploadId, ...updates }
//       console.log("Sending payload to API:", payload)

//       const response = await fetch("/api/update-row", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(payload),
//       })

//       console.log("API response status:", response.status)

//       if (!response.ok) {
//         const data = await response.json()
//         console.error("Failed to update row:", {
//           status: response.status,
//           error: data.error,
//           details: data.details,
//           debug: data.debug
//         })
//         let errorMsg = `Failed to update row: ${data.error}`
//         if (data.debug) errorMsg += `\nDebug: ${JSON.stringify(data.debug)}`
//         if (data.details) errorMsg += `\nDetails: ${data.details}`
//         alert(errorMsg)
//         return
//       }

//       const result = await response.json()
//       console.log("API response successful:", result)

//       if (result.recommendations) {
//         console.log("Updating local recos from API response")
//         setRecos(result.recommendations)
//       }

//       await new Promise((resolve) => setTimeout(resolve, 300))

//       console.log("Refreshing page to fetch updated data...")
//       router.refresh()

//       if (updates.hasOwnProperty("quantity")) {
//         console.log("Quantity changed, triggering predictions...")

//         try {
//           if (qtyTriggerTimer.current) window.clearTimeout(qtyTriggerTimer.current)
//         } catch (e) {
//           /* ignore */
//         }

//         fetch("/api/trigger-predictions", {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({ upload_id: uploadId, action: "qty_updated", rowId }),
//         }).then((triggerResponse) => {
//           console.log("Trigger-predictions response:", triggerResponse.status)
//         }).catch((e) => {
//           console.error("Error triggering predictions:", e)
//         })

//         setTimeout(() => {
//           console.log("Fetching latest recommendations after qty update")
//           fetchRecommendations()
//         }, 1500)
//       }

//     } catch (e) {
//       console.error("Error updating row:", e)
//     } finally {
//       await new Promise((resolve) => setTimeout(resolve, 2500))
//       setUpdatingIds((prev) => {
//         const next = new Set(prev)
//         next.delete(rowId)
//         return next
//       })
//       console.log("Update complete for row:", rowId)
//     }
//   }

//   useEffect(() => {
//     return () => {
//       if (qtyTriggerTimer.current) {
//         try { window.clearTimeout(qtyTriggerTimer.current) } catch (e) { /* ignore */ }
//       }
//     }
//   }, [])

//   async function triggerRefresh() {
//     try {
//       await fetch("/api/trigger-predictions", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ upload_id: uploadId, action: "manual_refresh" }),
//       })
//       router.refresh()
//     } catch (e) {
//       console.error(e)
//     }
//   }

//   async function updateAISuggestion(recoId: string, reco: AIRecommendation,) {
//     setUpdatingIds((prev) => new Set(prev).add(recoId))
//     try {
//       const response = await fetch("/api/update-ai-suggestion", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ recoId, reco }),
//       })
      
//       if (!response.ok) {
//         const data = await response.json()
//         toast.error(`Failed to update AI suggestion: ${data.error}`)
//         console.error("Failed to update AI suggestion:", data.error)
//         return
//       }

//       // Wait a bit for backend to trigger n8n webhook
//       // await new Promise((resolve) => setTimeout(resolve, 300))

//       // Poll for updated recommendations (max 10s, every 800ms)
//       const maxAttempts = 12;
//       let attempt = 0;
//       let updated = false;
//       while (attempt < maxAttempts && !updated) {
//         const recosResp = await fetch(`/api/recommendations?upload_id=${uploadId}`);
//         if (recosResp.ok) {
//           const data = await recosResp.json();
//           // You may want to check a specific field for update, here we just check if recommendations changed
//           if (data && data.recommendations) {
//             setRecos(data.recommendations);
//             // Optionally, check if the updated reco is reflected in the new data
//             const found = data.recommendations.find((r: any) => r.original_row_id === recoId && r.suggested_quantity === reco.suggested_quantity);
//             if (found) {
//               updated = true;
//               break;
//             }
//           }
//         }
//         attempt++;
//         // await new Promise((resolve) => setTimeout(resolve, 800));
//       }
      
//       toast.success("AI suggestion updated successfully")
//       await fetchRecommendations();
//       await router.refresh();
//     } catch (e) {
//       console.error("Error updating AI suggestion:", e)
//       toast.error(`Error to update AI suggestion: ${e}`)
//     } finally {
//       setUpdatingIds((prev) => {
//         const next = new Set(prev)
//         next.delete(recoId)
//         return next
//       })
//     }
//   }

//   const recoMap = new Map<string, AIRecommendation>()
//   for (const reco of recos) {
//     recoMap.set(`${reco.customer_name}::${reco.product_spec}`, reco)
//   }

//   function getDisplayRows(monthRows: GrossProfitRow[], page: number): RowWithSpan[] {
//     const start = page * ROWS_PER_PAGE
//     const end = start + ROWS_PER_PAGE
//     const paged = monthRows.slice(start, end)
//     const result: RowWithSpan[] = []
//     for (let i = 0; i < paged.length; i++) {
//       const row = paged[i]
//       const isFirst = i === 0 || paged[i - 1].customer_name !== row.customer_name
//       if (isFirst) {
//         let span = 1
//         for (let j = i + 1; j < paged.length; j++) {
//           if (paged[j].customer_name === row.customer_name) span++
//           else break
//         }
//         result.push({ ...row, rowSpan: span, isFirstOfCustomer: true })
//       } else result.push({ ...row, isFirstOfCustomer: false })
//     }
//     return result
//   }

//   function getRecoDisplayRows(recoList: AIRecommendation[]) {
//     const list = [...recoList].sort((a, b) => {
//       if (a.customer_name !== b.customer_name) return a.customer_name.localeCompare(b.customer_name)
//       return (a.product_spec || "").localeCompare(b.product_spec || "")
//     })
//     const result: Array<AIRecommendation & { rowSpan?: number; isFirstOfCustomer?: boolean }> = []
//     for (let i = 0; i < list.length; i++) {
//       const r = list[i]
//       const isFirst = i === 0 || list[i - 1].customer_name !== r.customer_name
//       if (isFirst) {
//         let span = 1
//         for (let j = i + 1; j < list.length; j++) {
//           if (list[j].customer_name === r.customer_name) span++
//           else break
//         }
//         result.push({ ...r, rowSpan: span, isFirstOfCustomer: true })
//       } else {
//         result.push({ ...r, isFirstOfCustomer: false })
//       }
//     }
//     return result
//   }

//   function getTotals(monthRows: GrossProfitRow[]) {
//     return {
//       quantity: monthRows.reduce((s, r) => s + (r.quantity || 0), 0),
//       amount_sales: monthRows.reduce((s, r) => s + (r.amount_sales || 0), 0),
//       freight_cost: monthRows.reduce((s, r) => s + (r.freight_cost || 0), 0),
//       net_sales: monthRows.reduce((s, r) => s + (r.net_sales || 0), 0),
//       cogs: monthRows.reduce((s, r) => s + (r.cogs || 0), 0),
//       gross_margin_value: monthRows.reduce((s, r) => s + (r.gross_margin_value || 0), 0),
//     }
//   }

//   const LoadingDots = () => (
//     <div className="flex items-center justify-center gap-1">
//       <div className="flex gap-0.5">
//         <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" />
//         <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.1s" }} />
//         <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.2s" }} />
//       </div>
//     </div>
//   )

//   // Only show the latest AI suggestion per original_row_id (by created_at desc)
//   const latestRecosMap = useMemo(() => {
//     const map = new Map<string, AIRecommendation>()
//     for (const reco of recos) {
//       if (!reco.original_row_id) continue
//       const existing = map.get(reco.original_row_id)
//       if (!existing || new Date(reco.created_at) > new Date(existing.created_at)) {
//         map.set(reco.original_row_id, reco)
//       }
//     }
//     return map
//   }, [recos])

//   const latestRecos = Array.from(latestRecosMap.values())
//   const aiPage = currentPage["ai"] || 0
//   const aiTotalPages = Math.max(1, Math.ceil(latestRecos.length / ROWS_PER_PAGE))
//   const aiStart = aiPage * ROWS_PER_PAGE
//   const aiPaged = latestRecos.slice(aiStart, aiStart + ROWS_PER_PAGE)
//   const aiDisplay = getRecoDisplayRows(aiPaged)

//   //new ai card
  
//   return (
//     <div className="flex flex-col gap-3">
//       {/* Status bar */}
//       <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
//         <div className="flex items-center gap-3">
//           {/* Show period/month count */}
//           <Badge variant="secondary" className="gap-1.5 bg-accent/15 text-accent ring-1 ring-accent/20 font-mono text-xs">
//             <span className="h-3 w-3 flex items-center justify-center">
//               <File className="h-3 w-3 text-secondary-foreground" />
//             </span>
//             {groupedByMonth.length} {groupedByMonth.length === 1 ? 'month data' : 'month data'}
//           </Badge>
//         </div>
//         <Button variant="ghost" size="sm" onClick={triggerRefresh} className="h-8 gap-2 text-muted-foreground hover:text-foreground">
//           <RefreshCw className="h-3.5 w-3.5" />
//           Refresh
//         </Button>
//       </div>

//       <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
//         <TabsList className="bg-secondary border border-border h-8 sm:h-10 p-0.5 sm:p-1 rounded-lg gap-0.5 sm:gap-1 flex-wrap sm:flex-nowrap">
//           {hasRecommendations && (
//             <TabsTrigger value="comparison" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
//               <ArrowLeftRight className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
//               <span className="hidden sm:inline">Comparison</span>
//               <span className="sm:hidden">Compare</span>
//               {/* <Zap className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
//               <span className="hidden sm:inline">AI Suggestion</span>
//               <span className="sm:hidden">AI</span> */}
//             </TabsTrigger>
//           )}
//           <TabsTrigger value="original" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
//             <Layers className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
//             <span className="hidden sm:inline">Original</span>
//             <span className="sm:hidden">Source</span>
//           </TabsTrigger>
//           <TabsTrigger value="ai1" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
//             <Zap className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
//             <span className="hidden sm:inline">AI Suggestion</span>
//             <span className="sm:hidden">AI</span>
//           </TabsTrigger>
          
//         </TabsList>

//         {/* AI Tab */}
//         {activeTab === "ai0" && (
//           <TabsContent value="ai1" className="mt-3 space-y-3">
//             {/* Prediction Period Button Group */}
//             <div className="flex items-center gap-2 mb-2">
//               <span className="text-xs font-semibold text-muted-foreground">Prediction Period:</span>
//               <ButtonGroup aria-label="Button group">
//               {[...Array(12)].map((_, idx) => (
               
//                   <Button key={idx + 1}
//                   className="rounded border border-border bg-secondary text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
//                   onClick={() => sendPredictionPeriod(idx + 1)}>
//                     {idx + 1}
//                   </Button>
//               ))}
              
//               </ButtonGroup>
//             </div>
//             {/* Alert for success/error */}
//             {alert && (
//               <div className={`my-2`}>
//                 <div className={`flex items-center gap-2 px-4 py-2 rounded border ${alert.type === 'success' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
//                   <span className="font-semibold">{alert.type === 'success' ? 'Success:' : 'Error:'}</span>
//                   <span>{alert.message}</span>
//                   <button className="ml-auto text-xs underline" onClick={() => setAlert(null)}>Dismiss</button>
//                 </div>
//               </div>
//             )}
//             {isLoading ? (
//               <div className="space-y-3">
//                 {[...Array(1)].map((_, i) => (
//                   <div key={i} className="rounded-lg border border-border overflow-hidden bg-card">
//                     <div className="flex items-center gap-3 bg-secondary/50 px-4 py-3 border-b border-border">
//                       <Skeleton className="h-4 w-4 rounded bg-slate-300" />
//                       <Skeleton className="h-4 w-32 bg-slate-300" />
//                       <Skeleton className="h-5 w-16 ml-auto rounded-full bg-slate-300" />
//                     </div>
//                   </div>
//                 ))}
//               </div>
//             ):(
//               <>
//                 {groupedByPredictionMonth.map((monthGroup) => {
//                   const monthKey = `comp-${monthGroup.year}-${monthGroup.month}`
//                   const isMonthOpen = expandedMonths.has(monthKey)
//                   const page = currentPage[monthKey] || 0
//                   const totalPages = Math.ceil(monthGroup.rows.length / ROWS_PER_PAGE)
//                   const totals = getTotals(monthGroup.rows)
//                   const pageRows = monthGroup.rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)

//                   const displayRows = (() => {
//                     const display: React.ReactNode[] = []

//                     const recoByRow = new Map<string, AIRecommendations>()
//                     recos.forEach((r) => {
//                       if (r.original_row_id) {
//                         recoByRow.set(r.original_row_id, r)
//                       }
//                     })

//                     const rowsByCustomer = new Map<string, GrossProfitRow[]>()
//                     pageRows.forEach((r) => {
//                       if (!rowsByCustomer.has(r.customer_name)) {
//                         rowsByCustomer.set(r.customer_name, [])
//                       }
//                       rowsByCustomer.get(r.customer_name)!.push(r)
//                     })

//                     let customerIdx = 0
//                     rowsByCustomer.forEach((customerRows, customer) => {
//                       const totalRowsForCustomer = customerRows.reduce((sum, row) => {
//                         return sum + (recoByRow.has(row.id) ? 1 : 0)
//                       }, 0)

//                       customerRows.forEach((row, rowIdx) => {
//                         const reco = recoByRow.get(row.id) as any | undefined
//                         const isUpdating = updatingIds.has(row.id)

//                         // AI suggestion row, if available
//                         if (reco) {
//                           display.push(
//                             <tr
//                               key={`ai-${customerIdx}-${rowIdx}`}
//                               className={`border-b border-border bg-primary/5 hover:bg-primary/10 transition-opacity ${isUpdating ? "opacity-60 pointer-events-none" : ""}`}
//                             >
//                               {rowIdx === 0 && (
//                                 <td
//                                   rowSpan={totalRowsForCustomer}
//                                   className="text-xs font-semibold text-foreground p-2 border-r border-border align-middle text-center bg-card/80 break-words max-w-[80px]"
//                                 >
//                                   {customer}
//                                 </td>
//                               )}
//                               <td className="p-2 border-r border-border">
//                                 {isUpdating ? <LoadingDots /> : (
//                                   <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
//                                     AI Suggestion
//                                   </span>
//                                 )}
//                               </td>
//                               <td className="text-xs text-foreground font-medium p-2 border-r border-border">{isUpdating ? <LoadingDots /> : reco.product_spec}</td>
//                               {isUpdating ? <LoadingDots /> : (
//                                 <Input type="number" defaultValue={reco.suggested_quantity} className="text-xs font-mono text-right p-2 border-r border-border text-primary"
//                                   //onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v) && v !== reco.suggested_quantity) updateAISuggestion(row.id, { suggested_quantity: v, suggested_amount_sales: reco.suggested_amount_sales, suggested_freight_cost: reco.suggested_freight_cost, suggested_cogs: reco.suggested_cogs, predicted_net_sales: reco.predicted_net_sales,  predicted_gm_value: reco.predicted_gm_value }, reco) }} 
//                                   onBlur={(e) => { 
//                                     const v = parseFloat(e.currentTarget.value); 
//                                     if (!isNaN(v) && v !== reco.suggested_quantity) {
//                                       updateAISuggestion(row.id, { ...reco, suggested_quantity: v });
//                                     }
//                                   }}
//                                 />
//                               )}
//                               {/* <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_quantity)}</td> */}
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_amount_sales)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_freight_cost)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_cogs)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.predicted_net_sales)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.predicted_gm_value)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">
//                                 {isUpdating ? <LoadingDots /> : (
//                                   <span className={reco.predicted_gm_percent && reco.predicted_gm_percent < 0 ? "text-red-500 font-semibold" : "text-accent font-semibold"}>
//                                     {formatPercent(reco.predicted_gm_percent)}
//                                   </span>
//                                 )}
//                               </td>
//                               <td className="text-xs text-center p-2 border-r border-border">
//                                 {isUpdating ? <LoadingDots /> : (
//                                   <Badge className={`px-2 py-0.5 text-[10px] ${
//                                     reco.action === "BOOST" ? "bg-green-600/10 text-green-600" :
//                                     reco.action === "INTRODUCE" ? "bg-blue-600/10 text-blue-600" :
//                                     reco.action === "MAINTAIN" ? "bg-orange-500/10 text-orange-500" :
//                                     reco.action === "REDUCE" ? "bg-yellow-600/10 text-yellow-600" :
//                                     "bg-red-600/10 text-red-600"
//                                   }`}>
//                                     {reco.action}
//                                   </Badge>
//                                 )}
//                               </td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{isUpdating ? <LoadingDots /> : formatConfidence(reco.confidence_score)}</td>
//                               <td className="text-xs text-muted-foreground p-2 border-r border-border">{isUpdating ? <LoadingDots /> : reco.replaced_from ?? "—"}</td>
//                               <td className="text-xs p-2 break-words min-w-[260px] text-muted-foreground italic">{isUpdating ? <LoadingDots /> : reco.reason ?? "—"}</td>
//                             </tr>
//                           )
//                         }
//                       })

//                       // Subtotal row per customer
//                       // if (customerRows.length > 0) {
//                       //   const subtotal = customerRows.reduce(
//                       //     (acc, row) => {
//                       //       acc.quantity += row.quantity || 0
//                       //       acc.amount_sales += row.amount_sales || 0
//                       //       acc.freight_cost += row.freight_cost || 0
//                       //       acc.cogs += row.cogs || 0
//                       //       acc.net_sales += row.net_sales || 0
//                       //       acc.gross_margin_value += row.gross_margin_value || 0
//                       //       return acc
//                       //     },
//                       //     { quantity: 0, amount_sales: 0, freight_cost: 0, cogs: 0, net_sales: 0, gross_margin_value: 0 }
//                       //   )
//                       //   const subtotalNetSales = subtotal.amount_sales - subtotal.freight_cost
//                       //   const subtotalGMValue = subtotalNetSales - subtotal.cogs
//                       //   const subtotalGMPercent = subtotalNetSales !== 0 ? subtotalGMValue / subtotalNetSales : 0

//                       //   display.push(
//                       //     <tr key={`subtotal-${customerIdx}`} className="bg-secondary/20 border-t-2 border-border font-semibold">
//                       //       <td colSpan={3} className="text-xs font-semibold text-foreground p-2 border-r border-border">ACTUAL SUBTOTAL</td>
//                       //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.quantity)}</td>
//                       //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.amount_sales)}</td>
//                       //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.freight_cost)}</td>
//                       //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.cogs)}</td>
//                       //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotalNetSales)}</td>
//                       //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotalGMValue)}</td>
//                       //       <td className="text-xs font-mono text-right p-2 border-r border-border">{formatPercent(subtotalGMPercent)}</td>
//                       //       <td colSpan={4}></td>
//                       //     </tr>
//                       //   )
//                       // }

//                       // Subtotal row per customer AI (using AI suggestion fields)
//                       if (customerRows.length > 0) {
//                         // Find all AI recommendations for this customer
//                         const aiRecos = customerRows
//                           .map(row => recoByRow.get(row.id))
//                           .filter(r => r);
//                         if (aiRecos.length > 0) {
//                           const subtotal = aiRecos.reduce(
//                             (acc, reco) => {
//                               acc.suggested_quantity += reco.suggested_quantity || 0;
//                               acc.suggested_amount_sales += reco.suggested_amount_sales || 0;
//                               acc.suggested_freight_cost += reco.suggested_freight_cost || 0;
//                               acc.suggested_cogs += reco.suggested_cogs || 0;
//                               return acc;
//                             },
//                             { suggested_quantity: 0, suggested_amount_sales: 0, suggested_freight_cost: 0, suggested_cogs: 0 }
//                           );
//                           const subtotalNetSales = subtotal.suggested_amount_sales - subtotal.suggested_freight_cost;
//                           const subtotalGMValue = subtotalNetSales - subtotal.suggested_cogs;
//                           const subtotalGMPercent = subtotalNetSales !== 0 ? subtotalGMValue / subtotalNetSales : 0;

//                           display.push(
//                             <tr key={`ai-subtotal-${customerIdx}`} className="bg-primary/10 border-t-2 border-primary/10 font-semibold">
//                               <td colSpan={3} className="text-xs font-semibold text-primary p-2 border-r border-border">AI SUBTOTAL</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_quantity)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_amount_sales)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_freight_cost)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_cogs)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotalNetSales)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotalGMValue)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border font-semibold text-accent">{formatPercent(subtotalGMPercent)}</td>
//                               <td colSpan={4}></td>
//                             </tr>
//                           );
//                         }
//                       }
                      

//                       // Spacer between customers
//                       if (customerIdx < rowsByCustomer.size - 1) {
//                         display.push(
//                           <tr key={`spacer-${customerIdx}`} className="border-t-2 border-primary/60">
//                             <td colSpan={14} />
//                           </tr>
//                         )
//                       }

//                       customerIdx++
//                     })

//                     return display
//                   })()

//                   return (
//                     <div key={monthKey} className="rounded-lg border border-border overflow-hidden bg-card flex flex-col">
//                       <button
//                         onClick={() => toggleMonth(monthKey)}
//                         className="w-full flex items-center gap-3 bg-secondary/50 hover:bg-secondary/70 px-4 py-3 border-b border-border transition-colors"
//                       >
//                         {isMonthOpen ? (
//                           <ChevronDown className="h-4 w-4 text-primary" />
//                         ) : (
//                           <ChevronRight className="h-4 w-4 text-muted-foreground" />
//                         )}
//                         <span className="font-semibold text-foreground">{formatMonthYear(monthGroup.month, monthGroup.year)}</span>
//                         <Badge variant="secondary" className="ml-auto text-xs font-mono">
//                           {monthGroup.rows.length} rows
//                         </Badge>
//                       </button>

//                       {!isMonthOpen && <div className="px-4 py-2 text-xs text-muted-foreground/50">Click to expand</div>}

//                       {isMonthOpen && (
//                         <div className="max-h-[600px] overflow-y-auto overflow-x-auto scrollbar-hide">
//                           <table className="w-full text-xs border-collapse">
//                             <thead className="sticky top-0 z-10">
//                               <tr className="bg-card border-b border-border">
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Customer</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Type</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Product</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Qty</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Sales</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Freight</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">COGS</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Net Sales</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">GM Val</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">GM %</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-center p-2 border-r border-border">Action</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Confidence</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Replaced From</th>
//                                 <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2">Reason</th>
//                               </tr>
//                             </thead>
//                             <tbody>
//                               {displayRows}
//                             </tbody>
//                             {monthGroup.rows.length > 0 && (
//                               <tfoot>
//                                 <tr className="sticky bottom-0 z-20 bg-card border-b border-border font-semibold">
//                                   <td colSpan={3} className="text-xs font-semibold text-foreground p-2 border-r border-border">TOTAL</td>
//                                   <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.quantity)}</td>
//                                   <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales)}</td>
//                                   <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.freight_cost)}</td>
//                                   <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.cogs)}</td>
//                                   <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales - totals.freight_cost)}</td>
//                                   <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber((totals.amount_sales - totals.freight_cost) - totals.cogs)}</td>
//                                   <td className="text-xs font-mono text-right p-2 border-r border-border">{formatPercent(((totals.amount_sales - totals.freight_cost) - totals.cogs) / (totals.amount_sales - totals.freight_cost))}</td>
//                                   <td colSpan={4}></td>
//                                 </tr>
//                               </tfoot>
//                             )}
//                           </table>
//                         </div>
//                       )}

//                       {totalPages > 1 && (
//                         <div className="flex items-center justify-center gap-2 border-t border-border p-3 bg-card/50">
//                           <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.max(0, page - 1) })} disabled={page === 0}>
//                             Prev
//                           </Button>
//                           <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
//                           <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.min(totalPages - 1, page + 1) })} disabled={page === totalPages - 1}>
//                             Next
//                           </Button>
//                         </div>
//                       )}
//                     </div>
//                   )
//                 })}
//               </>
//             )}
//           </TabsContent>
//         )}

//         {/* AI TAB NEW */}
//         {activeTab === "ai1" && (
//           <TabsContent value="ai1" className="mt-3 space-y-3">
//             {isAiLoading ? (
//               <div className="p-10 flex flex-col items-center"><Loader2 className="animate-spin" /> Analyzing...</div>
//             ) : (
//               <CustomerStrategyCarousel data={aiStrategies} />
//             )}
//           </TabsContent>
//         )}
//         {/* Original Tab */}
//         {activeTab === "original" && (
//           <TabsContent value="original" className="mt-6 space-y-6">
//             {groupedByMonth.map((monthGroup) => {
//               const monthKey = `orig-${monthGroup.year}-${monthGroup.month}`
//               const isMonthOpen = expandedMonths.has(monthKey)
//               const page = currentPage[monthKey] || 0
//               const totalPages = Math.ceil(monthGroup.rows.length / ROWS_PER_PAGE)
//               const displayRows = getDisplayRows(monthGroup.rows, page)
//               const totals = getTotals(monthGroup.rows)

//               return (
//                 <div key={monthKey} className="rounded-lg border border-border overflow-hidden bg-card flex flex-col">
//                   <button onClick={() => toggleMonth(monthKey)} className="w-full flex items-center gap-3 bg-secondary/50 hover:bg-secondary/70 px-4 py-3 border-b border-border transition-colors">
//                     {isMonthOpen ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
//                     <span className="font-semibold text-foreground">{formatMonthYear(monthGroup.month, monthGroup.year)}</span>
//                     <Badge variant="secondary" className="ml-auto text-xs font-mono">{monthGroup.rows.length} rows</Badge>
//                   </button>

//                   {!isMonthOpen && <div className="px-4 py-2 text-xs text-muted-foreground/50">Click to expand</div>}

//                   {isMonthOpen && (
//                     <div className="max-h-[600px] overflow-y-auto overflow-x-auto scrollbar-hide">
//                       <table className="w-full text-xs border-collapse">
//                         <thead className="sticky top-0 z-10">
//                           <tr className="bg-secondary border-b border-border">
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-left p-2 border-r border-border">Customer</th>
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-left p-2 border-r border-border">Product</th>
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">Qty</th>
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">Sales</th>
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">Freight</th>
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">Net Sales</th>
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">COGS</th>
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2 border-r border-border">GM Val</th>
//                             <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2">Status</th>
//                           </tr>
//                         </thead>
//                         <tbody>
//                           {displayRows.map((row, idx) => (
//                             <tr key={row.id} className={`border-b border-border hover:bg-secondary/10 ${idx % 2 === 0 ? "bg-card" : "bg-card/50"}`}>
//                               {row.isFirstOfCustomer && <td rowSpan={row.rowSpan} className="text-xs font-medium text-foreground p-2 border-r border-border align-top">{row.customer_name}</td>}
//                               <td className="text-xs p-2 border-r border-border">
//                                 <input type="text" defaultValue={row.product_spec} className="w-20 bg-transparent text-xs py-1"
//                                   onBlur={(e) => { const val = e.currentTarget.value.trim(); if (val && val !== row.product_spec) updateRowField(row.id, { product_spec: val }) }} />
//                               </td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">
//                                 {updatingIds.has(row.id) ? <LoadingDots /> : (
//                                   <input
//                                     type="number"
//                                     defaultValue={row.quantity}
//                                     className="w-12 bg-transparent text-right text-xs py-1"
//                                     onBlur={(e) => {
//                                       const v = parseFloat(e.currentTarget.value)
//                                       if (!isNaN(v) && v !== row.quantity) updateRowField(row.id, { quantity: v })
//                                     }}
//                                     onKeyUp={(e) => {
//                                       const v = parseFloat(e.currentTarget.value)
//                                       if (!isNaN(v) && v !== row.quantity) {
//                                         if (qtyInputTimer.current) {
//                                           try { window.clearTimeout(qtyInputTimer.current) } catch {}
//                                         }
//                                         qtyInputTimer.current = window.setTimeout(() => {
//                                           updateRowField(row.id, { quantity: v })
//                                         }, 800)
//                                       }
//                                     }}
//                                   />
//                                 )}
//                               </td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.amount_sales)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.freight_cost)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.net_sales)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.cogs)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.gross_margin_value)}</td>
//                               <td className="text-xs p-2">
//                                 {row.status === "formula_mismatch"
//                                   ? <Badge variant="destructive" className="text-[8px] px-1 py-0 h-4">Mismatch</Badge>
//                                   : <Badge className="text-[8px] px-1 py-0 h-4 bg-accent/15 text-accent">OK</Badge>}
//                               </td>
//                             </tr>
//                           ))}
//                           <tr className="bg-secondary/20 border-t-2 border-border font-semibold">
//                             <td colSpan={2} className="text-xs font-semibold text-foreground border-r border-border">TOTAL</td>
//                             <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.quantity)}</td>
//                             <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales)}</td>
//                             <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.freight_cost)}</td>
//                             <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.net_sales)}</td>
//                             <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.cogs)}</td>
//                             <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.gross_margin_value)}</td>
//                             <td colSpan={2}></td>
//                           </tr>
//                         </tbody>
//                       </table>
//                     </div>
//                   )}

//                   {isMonthOpen && totalPages > 1 && (
//                     <div className="flex items-center justify-center gap-2 border-t border-border p-3 bg-card/50">
//                       <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.max(0, page - 1) })} disabled={page === 0}>Prev</Button>
//                       <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
//                       <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.min(totalPages - 1, page + 1) })} disabled={page === totalPages - 1}>Next</Button>
//                     </div>
//                   )}
//                 </div>
//               )
//             })}
//           </TabsContent>
//         )}

//         {/* Comparison Tab */}
//         {activeTab === "comparison" && hasRecommendations && (
//           <TabsContent value="comparison" className="mt-3 space-y-3">
//             {/* Prediction Period Button Group */}
//             {/* <div className="flex items-center gap-2 mb-2">
//               <span className="text-xs font-semibold text-muted-foreground">Prediction Period:</span>
//               <ButtonGroup aria-label="Button group">
//               {[...Array(12)].map((_, idx) => (
               
//                   <Button key={idx + 1}
//                   className="rounded border border-border bg-secondary text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
//                   onClick={() => sendPredictionPeriod(idx + 1)}>
//                     {idx + 1}
//                   </Button>
//               ))}
              
//               </ButtonGroup>
//             </div> */}
//             {/* Alert for success/error */}
//             {alert && (
//               <div className={`my-2`}>
//                 <div className={`flex items-center gap-2 px-4 py-2 rounded border ${alert.type === 'success' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
//                   <span className="font-semibold">{alert.type === 'success' ? 'Success:' : 'Error:'}</span>
//                   <span>{alert.message}</span>
//                   <button className="ml-auto text-xs underline" onClick={() => setAlert(null)}>Dismiss</button>
//                 </div>
//               </div>
//             )}
//             {groupedByMonth.map((monthGroup) => {
//               const monthKey = `comp-${monthGroup.year}-${monthGroup.month}`
//               const isMonthOpen = expandedMonths.has(monthKey)
//               const page = currentPage[monthKey] || 0
//               const totalPages = Math.ceil(monthGroup.rows.length / ROWS_PER_PAGE)
//               const totals = getTotals(monthGroup.rows)
//               const pageRows = monthGroup.rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)

//               const displayRows = (() => {
//                 const display: React.ReactNode[] = []

//                 const recoByRow = new Map<string, AIRecommendation>()
//                 recos.forEach((r) => {
//                   if (r.original_row_id) {
//                     recoByRow.set(r.original_row_id, r)
//                   }
//                 })

//                 const rowsByCustomer = new Map<string, GrossProfitRow[]>()
//                 pageRows.forEach((r) => {
//                   if (!rowsByCustomer.has(r.customer_name)) {
//                     rowsByCustomer.set(r.customer_name, [])
//                   }
//                   rowsByCustomer.get(r.customer_name)!.push(r)
//                 })

//                 let customerIdx = 0
//                 rowsByCustomer.forEach((customerRows, customer) => {
//                   const totalRowsForCustomer = customerRows.reduce((sum, row) => {
//                     return sum + 1 + (recoByRow.has(row.id) ? 1 : 0)
//                   }, 0)

//                   customerRows.forEach((row, rowIdx) => {
//                     const reco = recoByRow.get(row.id) as any | undefined
//                     const isUpdating = updatingIds.has(row.id)

//                     // Actual data row
//                     display.push(
//                       <tr
//                         key={`actual-${customerIdx}-${rowIdx}`}
//                         className={`border-b border-border hover:bg-secondary/10 bg-card transition-opacity ${isUpdating ? "opacity-60 pointer-events-none" : ""}`}
//                       >
//                         {rowIdx === 0 && (
//                           <td
//                             rowSpan={totalRowsForCustomer}
//                             className="text-xs font-semibold text-foreground p-2 border-r border-border align-middle text-center bg-card/80 break-words max-w-[80px]"
//                           >
//                             {customer}
//                           </td>
//                         )}
//                         <td className="p-2 border-r border-border">
//                           {isUpdating ? <LoadingDots /> : (
//                             <span className="text-[10px] font-medium text-muted-foreground bg-secondary/30 px-1.5 py-0.5 rounded">
//                               Actual
//                             </span>
//                           )}
//                         </td>
//                         <td className="text-xs text-foreground font-medium p-2 border-r border-border">
//                           {isUpdating ? <LoadingDots /> : row.product_spec}
//                         </td>
//                         {/* <td className="text-xs font-mono text-right p-2 border-r border-border">
//                           {isUpdating ? <LoadingDots /> : (
//                             <input type="number" defaultValue={row.quantity} className="w-12 bg-transparent text-right text-xs py-1"
//                               onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v) && v !== row.quantity) updateRowField(row.id, { quantity: v }) }} />
//                           )}
//                         </td> */}
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.quantity)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.amount_sales)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.freight_cost)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.cogs)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.net_sales)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{isUpdating ? <LoadingDots /> : formatNumber(row.gross_margin_value)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">
//                           {isUpdating ? <LoadingDots /> : (
//                             <span className={row.gross_margin_percent && row.gross_margin_percent < 0 ? "text-red-500 font-semibold" : "text-green-600 font-semibold"}>
//                               {formatPercent(row.gross_margin_percent)}
//                             </span>
//                           )}
//                         </td>
//                         {/* empty cells to line up with AI columns */}
//                         <td className="p-2 border-r border-border" />
//                         <td className="p-2 border-r border-border" />
//                         <td className="p-2 border-r border-border" />
//                         <td className="p-2" />
//                       </tr>
//                     )

//                     // AI suggestion row, if available
//                     if (reco) {
//                       display.push(
//                         <tr
//                           key={`ai-${customerIdx}-${rowIdx}`}
//                           className={`border-b border-border bg-primary/18 hover:bg-primary/10 transition-opacity ${isUpdating ? "opacity-60 pointer-events-none" : ""}`}
//                         >
//                           <td className="p-2 border-r border-border">
//                             {isUpdating ? <LoadingDots /> : (
//                               <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
//                                 AI Suggestion
//                               </span>
//                             )}
//                           </td>
//                           <td className="text-xs text-foreground font-medium p-2 border-r border-border">{isUpdating ? <LoadingDots /> : reco.product_spec}</td>
//                           {isUpdating ? <LoadingDots /> : (
//                             <Input type="number" defaultValue={reco.suggested_quantity} className="text-xs font-mono text-right p-2 border-r border-border text-primary"
//                               //onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v) && v !== reco.suggested_quantity) updateAISuggestion(row.id, { suggested_quantity: v, suggested_amount_sales: reco.suggested_amount_sales, suggested_freight_cost: reco.suggested_freight_cost, suggested_cogs: reco.suggested_cogs, predicted_net_sales: reco.predicted_net_sales,  predicted_gm_value: reco.predicted_gm_value }, reco) }} 
//                               onBlur={(e) => { 
//                                 const v = parseFloat(e.currentTarget.value); 
//                                 if (!isNaN(v) && v !== reco.suggested_quantity) {
//                                   updateAISuggestion(row.id, { ...reco, suggested_quantity: v });
//                                 }
//                               }}
//                             />
//                           )}
//                           {/* <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_quantity)}</td> */}
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_amount_sales)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_freight_cost)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.suggested_cogs)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.predicted_net_sales)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{isUpdating ? <LoadingDots /> : formatNumber(reco.predicted_gm_value)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border">
//                             {isUpdating ? <LoadingDots /> : (
//                               <span className={reco.predicted_gm_percent && reco.predicted_gm_percent < 0 ? "text-red-500 font-semibold" : "text-accent font-semibold"}>
//                                 {formatPercent(reco.predicted_gm_percent)}
//                               </span>
//                             )}
//                           </td>
//                           <td className="text-xs text-center p-2 border-r border-border">
//                             {isUpdating ? <LoadingDots /> : (
//                               <Badge className={`px-2 py-0.5 text-[10px] ${
//                                 reco.action === "BOOST" ? "bg-green-600/10 text-green-600" :
//                                 reco.action === "SUBTITUDE" ? "bg-blue-600/10 text-blue-600" :
//                                 reco.action === "MAINTAIN" ? "bg-orange-500/10 text-orange-500" :
//                                 reco.action === "REDUCE" ? "bg-yellow-600/10 text-yellow-600" :
//                                 "bg-red-600/10 text-red-600"
//                               }`}>
//                                 {reco.action}
//                               </Badge>
//                             )}
//                           </td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{isUpdating ? <LoadingDots /> : formatConfidence(reco.confidence_score)}</td>
//                           <td className="text-xs text-muted-foreground p-2 border-r border-border">{isUpdating ? <LoadingDots /> : reco.replaced_from ?? "—"}</td>
//                           <td className="text-xs p-2 break-words min-w-[260px] text-muted-foreground italic">{isUpdating ? <LoadingDots /> : reco.reason ?? "—"}</td>
//                         </tr>
//                       )
//                     }
//                   })

//                   // Subtotal row per customer
//                   if (customerRows.length > 0) {
//                     const subtotal = customerRows.reduce(
//                       (acc, row) => {
//                         acc.quantity += row.quantity || 0
//                         acc.amount_sales += row.amount_sales || 0
//                         acc.freight_cost += row.freight_cost || 0
//                         acc.cogs += row.cogs || 0
//                         acc.net_sales += row.net_sales || 0
//                         acc.gross_margin_value += row.gross_margin_value || 0
//                         return acc
//                       },
//                       { quantity: 0, amount_sales: 0, freight_cost: 0, cogs: 0, net_sales: 0, gross_margin_value: 0 }
//                     )
//                     const subtotalNetSales = subtotal.amount_sales - subtotal.freight_cost
//                     const subtotalGMValue = subtotalNetSales - subtotal.cogs
//                     const subtotalGMPercent = subtotalNetSales !== 0 ? subtotalGMValue / subtotalNetSales : 0

//                     display.push(
//                       <tr key={`subtotal-${customerIdx}`} className="bg-secondary/20 border-t-2 border-border font-semibold">
//                         <td colSpan={3} className="text-xs font-semibold text-foreground p-2 border-r border-border">ACTUAL SUBTOTAL</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.quantity)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.amount_sales)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.freight_cost)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotal.cogs)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotalNetSales)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(subtotalGMValue)}</td>
//                         <td className="text-xs font-mono text-right p-2 border-r border-border">{formatPercent(subtotalGMPercent)}</td>
//                         <td colSpan={4}></td>
//                       </tr>
//                     )
//                   }

//                   // Subtotal row per customer AI (using AI suggestion fields)
//                   if (customerRows.length > 0) {
//                     // Find all AI recommendations for this customer
//                     const aiRecos = customerRows
//                       .map(row => recoByRow.get(row.id))
//                       .filter(r => r);
//                     if (aiRecos.length > 0) {
//                       const subtotal = aiRecos.reduce(
//                         (acc, reco) => {
//                           acc.suggested_quantity += reco.suggested_quantity || 0;
//                           acc.suggested_amount_sales += reco.suggested_amount_sales || 0;
//                           acc.suggested_freight_cost += reco.suggested_freight_cost || 0;
//                           acc.suggested_cogs += reco.suggested_cogs || 0;
//                           return acc;
//                         },
//                         { suggested_quantity: 0, suggested_amount_sales: 0, suggested_freight_cost: 0, suggested_cogs: 0 }
//                       );
//                       const subtotalNetSales = subtotal.suggested_amount_sales - subtotal.suggested_freight_cost;
//                       const subtotalGMValue = subtotalNetSales - subtotal.suggested_cogs;
//                       const subtotalGMPercent = subtotalNetSales !== 0 ? subtotalGMValue / subtotalNetSales : 0;

//                       display.push(
//                         <tr key={`ai-subtotal-${customerIdx}`} className="bg-primary/10 border-t-2 border-primary/40 font-semibold">
//                           <td colSpan={3} className="text-xs font-semibold text-primary p-2 border-r border-border">AI SUBTOTAL</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_quantity)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_amount_sales)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_freight_cost)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotal.suggested_cogs)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotalNetSales)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(subtotalGMValue)}</td>
//                           <td className="text-xs font-mono text-right p-2 border-r border-border font-semibold text-accent">{formatPercent(subtotalGMPercent)}</td>
//                           <td colSpan={4}></td>
//                         </tr>
//                       );
//                     }
//                   }
                  

//                   // Spacer between customers
//                   if (customerIdx < rowsByCustomer.size - 1) {
//                     display.push(
//                       <tr key={`spacer-${customerIdx}`} className="border-t-2 border-primary/60">
//                         <td colSpan={14} />
//                       </tr>
//                     )
//                   }

//                   customerIdx++
//                 })

//                 return display
//               })()

//               return (
//                 <div key={monthKey} className="rounded-lg border border-border overflow-hidden bg-card flex flex-col">
//                   <button
//                     onClick={() => toggleMonth(monthKey)}
//                     className="w-full flex items-center gap-3 bg-secondary/50 hover:bg-secondary/70 px-4 py-3 border-b border-border transition-colors"
//                   >
//                     {isMonthOpen ? (
//                       <ChevronDown className="h-4 w-4 text-primary" />
//                     ) : (
//                       <ChevronRight className="h-4 w-4 text-muted-foreground" />
//                     )}
//                     <span className="font-semibold text-foreground">{formatMonthYear(monthGroup.month, monthGroup.year)}</span>
//                     <Badge variant="secondary" className="ml-auto text-xs font-mono">
//                       {monthGroup.rows.length} rows
//                     </Badge>
//                   </button>

//                   {!isMonthOpen && <div className="px-4 py-2 text-xs text-muted-foreground/50">Click to expand</div>}

//                   {isMonthOpen && (
//                     <div className="max-h-[600px] overflow-y-auto overflow-x-auto scrollbar-hide">
//                       <table className="w-full text-xs border-collapse">
//                         <thead className="sticky top-0 z-10">
//                           <tr className="bg-card border-b border-border">
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Customer</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Type</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Product</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Qty</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Sales</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Freight</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">COGS</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Net Sales</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">GM Val</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">GM %</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-center p-2 border-r border-border">Action</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Confidence</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Replaced From</th>
//                             <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2">Reason</th>
//                           </tr>
//                         </thead>
//                         <tbody>
//                           {displayRows}
//                         </tbody>
//                         {monthGroup.rows.length > 0 && (
//                           <tfoot>
//                             <tr className="sticky bottom-0 z-20 bg-card border-b border-border font-semibold">
//                               <td colSpan={3} className="text-xs font-semibold text-foreground p-2 border-r border-border">TOTAL</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.quantity)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.freight_cost)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.cogs)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(totals.amount_sales - totals.freight_cost)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber((totals.amount_sales - totals.freight_cost) - totals.cogs)}</td>
//                               <td className="text-xs font-mono text-right p-2 border-r border-border">{formatPercent(((totals.amount_sales - totals.freight_cost) - totals.cogs) / (totals.amount_sales - totals.freight_cost))}</td>
//                               <td colSpan={4}></td>
//                             </tr>
//                           </tfoot>
//                         )}
//                       </table>
//                     </div>
//                   )}

//                   {totalPages > 1 && (
//                     <div className="flex items-center justify-center gap-2 border-t border-border p-3 bg-card/50">
//                       <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.max(0, page - 1) })} disabled={page === 0}>
//                         Prev
//                       </Button>
//                       <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
//                       <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, [monthKey]: Math.min(totalPages - 1, page + 1) })} disabled={page === totalPages - 1}>
//                         Next
//                       </Button>
//                     </div>
//                   )}
//                 </div>
//               )
//             })}
//           </TabsContent>
//         )}
//       </Tabs>
//     </div>
//   )
// }