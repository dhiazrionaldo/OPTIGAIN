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

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
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
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState<Record<string, number>>({})
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState("original")
  const [scrollPositions, setScrollPositions] = useState<Record<string, number>>({})
  const qtyTriggerTimer = useRef<number | null>(null)
  const qtyInputTimer = useRef<number | null>(null)
  const [isLoading, setLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [hasAiFetched, setHasAiFetched] = useState(false);
  const [aiStrategies, setAiStrategies] = useState<CustomerStrategy[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  
  useEffect(() => {
    setRecos(recommendations)
  }, [recommendations])


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
      
      if (!Array.isArray(cleanData) || cleanData.length === 0) {
        console.warn("AI strategies response was empty or unrecognised shape:", aiData);
        setAiError("Received empty strategy data from the AI service.");
      } else {
        setAiStrategies(cleanData);
        setHasAiFetched(true);
        toast.success("AI Strategy generated successfully!");
      }
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


  // State for alert dialog
  // const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  

  useEffect(() => {
    return () => {
      if (qtyTriggerTimer.current) {
        try { window.clearTimeout(qtyTriggerTimer.current) } catch (e) { /* ignore */ }
      }
    }
  }, [])



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


  
  return (
    <div className="flex flex-col gap-3">
      {/* Status bar */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          {/* Show period/month count */}
          <Badge variant="secondary" className="gap-1.5 bg-accent-500 text-accent ring-1 ring-accent700 font-mono text-xs">
            <span className="h-3 w-3 flex items-center justify-center">
              <File className="h-3 w-3 text-secondary-foreground" />
            </span>
            {groupedByMonth.length} {groupedByMonth.length === 1 ? 'months data' : 'months data'}
          </Badge>
        </div>
        <div className="flex items-end gap-3">
          {/* refetch AI Strategiest */}
          <Button variant="outline" size="sm" onClick={fetchAiStrategies} className="gap-2 bg-primary hover:bg-primary/80 hover:text-primary-foreground text-primary-foreground font-medium">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh AI Strategies
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-secondary border border-border h-8 sm:h-10 p-0.5 sm:p-1 rounded-lg gap-0.5 sm:gap-1 flex-wrap sm:flex-nowrap">
          <TabsTrigger value="original" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-primary data-[state=active]:text-slate-100 data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
            <Layers className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
            <span className="hidden sm:inline">Original</span>
            <span className="sm:hidden">Source</span>
          </TabsTrigger>
          <TabsTrigger value="ai1" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-primary data-[state=active]:text-slate-100 data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
            <Zap className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
            <span className="hidden sm:inline">AI Suggestion</span>
            <span className="sm:hidden">AI</span>
          </TabsTrigger>
          
        </TabsList>

        {/* AI TAB NEW */}
        {activeTab === "ai1" && (
          <TabsContent value="ai1" className="mt-3 space-y-3">
            {isAiLoading ? (
              <div className="p-10 flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="animate-spin h-6 w-6" />
                <span className="text-sm">Generating AI strategies...</span>
              </div>
            ) : aiError ? (
              <div className="flex flex-col items-center gap-4 p-10 border-2 border-dashed border-destructive/30 rounded-xl">
                <p className="text-sm text-destructive">{aiError}</p>
                <Button variant="outline" size="sm" onClick={fetchAiStrategies} className="gap-2 hover:text-slate-50 hover:bg-destructive/80 bg-destructive text-slate-100 font-medium">
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
                          <tr className="bg-primary/100 border-b border-border">
                            <th className="text-[10px] uppercase tracking-wider text-primary-foreground font-semibold text-left p-2 border-r border-border">Customer</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary-foreground font-semibold text-left p-2 border-r border-border">Product</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary-foreground font-semibold text-right p-2 border-r border-border">Qty</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary-foreground font-semibold text-right p-2 border-r border-border">Sales</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary-foreground font-semibold text-right p-2 border-r border-border">Freight</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary-foreground font-semibold text-right p-2 border-r border-border">Net Sales</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary-foreground font-semibold text-right p-2 border-r border-border">COGS</th>
                            <th className="text-[10px] uppercase tracking-wider text-primary-foreground font-semibold text-right p-2 border-r border-border">GM Val</th>
                            {/* <th className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold text-right p-2">Status</th> */}
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
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.quantity)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.amount_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.freight_cost)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.net_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.cogs)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.gross_margin_value)}</td>
                            </tr>
                          ))}
                          <tr className="bg-primary/100 text-primary-foreground border-t-2 border-border font-semibold">
                            <td colSpan={2} className="text-xs font-semibold border-r border-border">TOTAL</td>
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
      </Tabs>
    </div>
  )
}