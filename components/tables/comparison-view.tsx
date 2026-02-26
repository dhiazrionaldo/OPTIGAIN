"use client"

import React, { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RefreshCw, Clock, Layers, Zap, ArrowLeftRight, ChevronDown, ChevronRight } from "lucide-react"
import type { GrossProfitRow, AIRecommendation } from "@/lib/database.types"

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
  const hasRecommendations = recommendations.length > 0
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState<Record<string, number>>({})

  function toggleMonth(key: string) {
    const next = new Set(expandedMonths)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedMonths(next)
  }

  // Group by sheet month/year
  // build a helper map of recommendation action by row id for sorting
  const recoByRowIdForSort = useMemo(() => {
    const m = new Map<string, string>()
    recommendations.forEach((r) => {
      if (r.original_row_id) m.set(r.original_row_id as string, r.action || "")
    })
    return m
  }, [recommendations])

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
          // same customer: sort by recommendation action order if present
          const order: Record<string, number> = { BOOST: 0, REDUCE: 1, REPLACE: 2 }
          const oa = recoByRowIdForSort.get(a.id)
          const ob = recoByRowIdForSort.get(b.id)
          if (oa && ob && oa !== ob) return (order[oa] ?? 3) - (order[ob] ?? 3)
          // fallback to product spec
          return (a.product_spec || "").localeCompare(b.product_spec || "")
        })
        return g
      })
  }, [rows, recoByRowIdForSort])

  async function updateRowField(rowId: string, updates: Record<string, any>) {
    try {
      await fetch("/api/update-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, upload_id: uploadId, ...updates }),
      })
      router.refresh()
    } catch (e) {
      console.error(e)
    }
  }

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

  const recoMap = new Map<string, AIRecommendation>()
  for (const reco of recommendations) {
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
    // sort by customer then product to ensure grouping
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

  // AI tab pagination/display (compute outside JSX to avoid complex IIFE in markup)
  const aiPage = currentPage["ai"] || 0
  const aiTotalPages = Math.max(1, Math.ceil(recommendations.length / ROWS_PER_PAGE))
  const aiStart = aiPage * ROWS_PER_PAGE
  const aiPaged = recommendations.slice(aiStart, aiStart + ROWS_PER_PAGE)
  const aiDisplay = getRecoDisplayRows(aiPaged)

  return (
    <div className="flex flex-col gap-3">
      {/* Status bar */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5 bg-secondary text-secondary-foreground ring-1 ring-border font-mono text-xs">
            <Layers className="h-3 w-3" />
            {rows.length} rows
          </Badge>
          {hasRecommendations ? (
            <Badge className="gap-1.5 bg-accent/15 text-accent ring-1 ring-accent/20 font-mono text-xs">
              <Zap className="h-3 w-3" />
              {recommendations.length} predictions
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-chart-3/30 text-chart-3 text-xs animate-pulse">
              <Clock className="h-3 w-3" />
              Waiting for AI prediction...
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={triggerRefresh} className="h-8 gap-2 text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="comparison" className="w-full">
        <TabsList className="bg-secondary border border-border h-8 sm:h-10 p-0.5 sm:p-1 rounded-lg gap-0.5 sm:gap-1 flex-wrap sm:flex-nowrap">
          <TabsTrigger value="comparison" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
            <ArrowLeftRight className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
            <span className="hidden sm:inline">Comparison</span>
            <span className="sm:hidden">Compare</span>
          </TabsTrigger>
          <TabsTrigger value="original" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
            <Layers className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
            <span className="hidden sm:inline">Original</span>
            <span className="sm:hidden">Source</span>
          </TabsTrigger>
          {/* {hasRecommendations && (
            <TabsTrigger value="ai" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
              <Zap className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
              <span className="hidden sm:inline">AI Suggested</span>
              <span className="sm:hidden">AI</span>
            </TabsTrigger>
          )} */}
           {hasRecommendations && (
            <TabsTrigger value="ai1" className="gap-0.5 sm:gap-1.5 text-[10px] sm:text-xs data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-md py-1 sm:py-auto">
              <Zap className="h-2.5 sm:h-3.5 w-2.5 sm:w-3.5" />
              <span className="hidden sm:inline">AI Suggestion</span>
              <span className="sm:hidden">AI</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* Comparison Tab */}
        <TabsContent value="comparison" className="mt-3 space-y-3">
          {groupedByMonth.map((monthGroup) => {
            const monthKey = `comp-${monthGroup.year}-${monthGroup.month}`
            const isMonthOpen = expandedMonths.has(monthKey)
            const page = currentPage[monthKey] || 0
            const totalPages = Math.ceil(monthGroup.rows.length / ROWS_PER_PAGE)
            const totals = getTotals(monthGroup.rows)

            // take only the rows for the current page so pagination still applies to the "actual" dataset
            const pageRows = monthGroup.rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)

            // build paired display rows (actual + optional AI suggestion) in the same style as the AI1 tab
            const displayRows = (() => {
              const display: React.ReactNode[] = []

              // map recommendations by original row id for quick lookup
              const recoByRow = new Map<string, AIRecommendation>()
              recommendations.forEach((r) => {
                if (r.original_row_id) {
                  recoByRow.set(r.original_row_id, r)
                }
              })

              // group pageRows by customer
              const rowsByCustomer = new Map<string, GrossProfitRow[]>()
              pageRows.forEach((r) => {
                if (!rowsByCustomer.has(r.customer_name)) {
                  rowsByCustomer.set(r.customer_name, [])
                }
                rowsByCustomer.get(r.customer_name)!.push(r)
              })

              let customerIdx = 0
              rowsByCustomer.forEach((rows, customer) => {
                // compute how many table rows this customer will occupy (actual + ai rows)
                const totalRowsForCustomer = rows.reduce((sum, row) => {
                  return sum + 1 + (recoByRow.has(row.id) ? 1 : 0)
                }, 0)

                rows.forEach((row, rowIdx) => {
                  const reco = recoByRow.get(row.id) as any | undefined

                  // actual data row
                  display.push(
                    <tr
                      key={`actual-${customerIdx}-${rowIdx}`}
                      className="border-b border-border hover:bg-secondary/10 bg-card"
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
                        <span className="text-[10px] font-medium text-muted-foreground bg-secondary/30 px-1.5 py-0.5 rounded">
                          Actual
                        </span>
                      </td>
                      <td className="text-xs text-foreground font-medium p-2 border-r border-border">
                        {row.product_spec}
                      </td>
                      <td className="text-xs font-mono text-right p-2 border-r border-border">
                        {formatNumber(row.quantity)}
                      </td>
                      <td className="text-xs font-mono text-right p-2 border-r border-border">
                        {formatNumber(row.amount_sales)}
                      </td>
                      <td className="text-xs font-mono text-right p-2 border-r border-border">
                        {formatNumber(row.freight_cost)}
                      </td>
                      <td className="text-xs font-mono text-right p-2 border-r border-border">
                        {formatNumber(row.cogs)}
                      </td>
                      <td className="text-xs font-mono text-right p-2 border-r border-border">
                        {formatNumber(row.net_sales)}
                      </td>
                      <td className="text-xs font-mono text-right p-2 border-r border-border">
                        {formatNumber(row.gross_margin_value)}
                      </td>
                      <td
                        className={`text-xs font-mono font-semibold text-right p-2 border-r border-border ${
                          row.gross_margin_percent && row.gross_margin_percent < 0
                            ? "text-red-500"
                            : "text-green-600"
                        }`}
                      >
                        {formatPercent(row.gross_margin_percent)}
                      </td>
                      {/* empty cells to line up with AI columns */}
                      <td className="p-2 border-r border-border" />
                      <td className="p-2 border-r border-border" />
                      <td className="p-2 border-r border-border" />
                      <td className="p-2" />
                    </tr>
                  )

                  // ai suggestion row, if available
                  if (reco) {
                    display.push(
                      <tr
                        key={`ai-${customerIdx}-${rowIdx}`}
                        className="border-b border-border bg-primary/5 hover:bg-primary/10"
                      >
                        <td className="p-2 border-r border-border">
                          <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            AI Suggestion
                          </span>
                        </td>
                        <td className="text-xs text-foreground font-medium p-2 border-r border-border">
                          {reco.product_spec}
                        </td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">
                          {formatNumber(reco.suggested_quantity)}
                        </td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">
                          {formatNumber(reco.suggested_amount_sales)}
                        </td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">
                          {formatNumber(reco.suggested_freight_cost)}
                        </td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">
                          {formatNumber(reco.suggested_cogs)}
                        </td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">
                          {formatNumber(reco.predicted_net_sales)}
                        </td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">
                          {formatNumber(reco.predicted_gm_value)}
                        </td>
                        <td
                          className={`text-xs font-mono font-semibold text-right p-2 border-r border-border ${
                            reco.predicted_gm_percent && reco.predicted_gm_percent < 0
                              ? "text-red-500"
                              : "text-accent"
                          }`}
                        >
                          {formatPercent(reco.predicted_gm_percent)}
                        </td>
                        <td className="text-xs text-center p-2 border-r border-border">
                          <Badge
                            className={`px-2 py-0.5 text-[10px] ${
                              reco.action === "BOOST"
                                ? "bg-green-600/10 text-green-600"
                                : reco.action === "REPLACE"
                                ? "bg-orange-500/10 text-orange-500"
                                : reco.action === "REDUCE"
                                ? "bg-yellow-600/10 text-yellow-600"
                                : "bg-red-600/10 text-red-600"
                            }`}
                          >
                            {reco.action}
                          </Badge>
                        </td>
                        <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">
                          {formatConfidence(reco.confidence_score)}
                        </td>
                        <td className="text-xs text-muted-foreground p-2 border-r border-border">
                          {reco.replaced_from ?? "—"}
                        </td>
                        <td className="text-xs p-2 break-words min-w-[260px] text-muted-foreground italic">
                          {reco.reason ?? "—"}
                        </td>
                      </tr>
                    )
                  }
                })

                // spacer between customers - render as a bold top border line
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
            })();

            return (
              <div key={monthKey} className="rounded-lg border border-border overflow-hidden bg-card flex flex-col">
                {/* Month Header - Expandable */}
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
                      <tbody>{displayRows}</tbody>
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

        {/* Original Tab */}
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
                              <input type="text" defaultValue={row.product_spec} className="w-20 bg-transparent text-xs py-1" onBlur={(e) => { const val = e.currentTarget.value.trim(); if (val && val !== row.product_spec) updateRowField(row.id, { product_spec: val }) }} />
                            </td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border">
                              <input type="number" defaultValue={row.quantity} className="w-12 bg-transparent text-right text-xs py-1" onBlur={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v) && v !== row.quantity) updateRowField(row.id, { quantity: v }) }} />
                            </td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.amount_sales)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.freight_cost)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.net_sales)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.cogs)}</td>
                            <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">{formatNumber(row.gross_margin_value)}</td>
                            <td className="text-xs p-2">{row.status === "formula_mismatch" ? <Badge variant="destructive" className="text-[8px] px-1 py-0 h-4">Mismatch</Badge> : <Badge className="text-[8px] px-1 py-0 h-4 bg-accent/15 text-accent">OK</Badge>}</td>
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

        {/* AI Tab
        {hasRecommendations && (
          <TabsContent value="ai" className="mt-6">
              <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
                <div className="max-h-[600px] overflow-y-auto overflow-x-auto scrollbar-hide">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-card border-b border-border">
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Customer</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Product</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Sug. Qty</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Sug. Sales</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Sug. Freight</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Sug. COGS</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Pred. Net Sales</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Pred. GM Val</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Pred. GM %</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-center p-2 border-r border-border">Action</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-right p-2 border-r border-border">Confidence</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2 border-r border-border">Replaced From</th>
                      <th className="text-[10px] uppercase tracking-wider text-primary/60 font-semibold text-left p-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiDisplay.map((reco, idx) => {
                      const r = reco as any
                      return (
                        <tr key={reco.id} className={`border-b border-border hover:bg-secondary/10 ${idx % 2 === 0 ? "bg-card" : "bg-card/50"}`}>
                          {reco.isFirstOfCustomer && (
                            <td rowSpan={reco.rowSpan} className="text-xs font-medium text-foreground p-2 border-r border-border align-top break-words max-w-[80px]">{reco.customer_name}</td>
                          )}
                          <td className="text-xs text-muted-foreground p-2 border-r border-border">{reco.product_spec}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border">{formatNumber(r.suggested_quantity)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary/80">{formatNumber(r.suggested_amount_sales)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary/80">{formatNumber(r.suggested_freight_cost)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary/80">{formatNumber(r.suggested_cogs)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary/80">{formatNumber(r.predicted_net_sales)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border text-primary/80">{formatNumber(r.predicted_gm_value)}</td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border font-semibold text-accent">{formatPercent(r.predicted_gm_percent)}</td>
                          <td className="text-xs text-center p-2 border-r border-border">
                            <Badge className={`px-2 py-0.5 text-[10px] ${r.action === "BOOST" ? "bg-green-600/10 text-green-600" : "bg-yellow-600/10 text-yellow-600"}`}>{r.action}</Badge>
                          </td>
                          <td className="text-xs font-mono text-right p-2 border-r border-border">{formatConfidence(r.confidence_score)}</td>
                          <td className="text-xs text-muted-foreground p-2 border-r border-border">{r.replaced_from ?? "—"}</td>
                          <td className="text-xs p-2 break-words min-w-[260px] text-muted-foreground">{r.reason}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </div>
              {Math.ceil(recommendations.length / ROWS_PER_PAGE) > 1 && (
                <div className="flex items-center justify-center gap-2 border-t border-border p-3 bg-card/50">
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, ["ai"]: Math.max(0, (currentPage["ai"] || 0) - 1) })} disabled={(currentPage["ai"] || 0) === 0}>Prev</Button>
                  <span className="text-xs text-muted-foreground">Page {(currentPage["ai"] || 0) + 1} of {Math.max(1, Math.ceil(recommendations.length / ROWS_PER_PAGE))}</span>
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, ["ai"]: Math.min(Math.max(1, Math.ceil(recommendations.length / ROWS_PER_PAGE)) - 1, (currentPage["ai"] || 0) + 1) })} disabled={(currentPage["ai"] || 0) === Math.max(0, Math.ceil(recommendations.length / ROWS_PER_PAGE) - 1)}>Next</Button>
                </div>
              )}
          </TabsContent>
        )} */}

        {/* AI Tab Another */}
        {hasRecommendations && (
        <TabsContent value="ai1" className="mt-6">
            <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
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
                    {useMemo(() => {
                      const displayRows: React.ReactNode[] = []
                      
                      // Create a map of all rows by ID for quick lookup
                      const rowsById = new Map<string, GrossProfitRow>()
                      rows.forEach(row => {
                        rowsById.set(row.id, row)
                      })

                      // Group recommendations by customer, sorting by action order
                      const customerMap = new Map<string, typeof recommendations>()
                      const actionOrder: Record<string, number> = { BOOST: 0, REDUCE: 1, REPLACE: 2 }
                      recommendations.forEach(reco => {
                        if (!customerMap.has(reco.customer_name)) {
                          customerMap.set(reco.customer_name, [])
                        }
                        customerMap.get(reco.customer_name)!.push(reco)
                      })
                      // sort each customer's list in place
                      for (const recos of customerMap.values()) {
                        recos.sort((a, b) => {
                          const oa = actionOrder[a.action ?? ""] ?? 3
                          const ob = actionOrder[b.action ?? ""] ?? 3
                          if (oa !== ob) return oa - ob
                          return 0
                        })
                      }

                      const customers = Array.from(customerMap.entries())

                      customers.forEach(([customer, recos], customerIdx) => {
                        const totalRows = recos.length * 2

                        recos.forEach((aiRec, recoIdx) => {
                          const r = aiRec as any
                          // Get the original row by original_row_id if available
                          const original = r.original_row_id ? rowsById.get(r.original_row_id) : null

                          // Original data row
                          displayRows.push(
                            <tr key={`orig-${customerIdx}-${recoIdx}`} className="border-b border-border/50 bg-card hover:bg-secondary/5">
                              {recoIdx === 0 && (
                                <td rowSpan={totalRows} className="text-xs font-semibold text-foreground p-2 border-r border-border align-middle text-center bg-card/80 break-words max-w-[80px]">
                                  {customer}
                                </td>
                              )}
                              <td className="p-2 border-r border-border">
                                <span className="text-[10px] font-medium text-muted-foreground bg-secondary/30 px-1.5 py-0.5 rounded">
                                  Actual
                                </span>
                              </td>
                              <td className="text-xs text-foreground font-medium p-2 border-r border-border">{original?.product_spec || "—"}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{original ? formatNumber(original.quantity) : "—"}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{original ? formatNumber(original.amount_sales) : "—"}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{original ? formatNumber(original.freight_cost) : "—"}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{original ? formatNumber(original.cogs) : "—"}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{original ? formatNumber(original.net_sales) : "—"}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border">{original ? formatNumber(original.gross_margin_value) : "—"}</td>
                              <td className={`text-xs font-mono font-semibold text-right p-2 border-r border-border ${original && original.gross_margin_percent && original.gross_margin_percent < 0 ? "text-red-500" : "text-green-600"}`}>
                                {original ? formatPercent(original.gross_margin_percent) : "—"}
                              </td>
                              <td className="p-2 border-r border-border" />
                              <td className="p-2 border-r border-border" />
                              <td className="p-2 border-r border-border" />
                              <td className="p-2" />
                            </tr>
                          )

                          // AI Suggestion row
                          displayRows.push(
                            <tr key={`ai-${customerIdx}-${recoIdx}`} className="border-b border-border bg-primary/5 hover:bg-primary/10">
                              <td className="p-2 border-r border-border">
                                <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                  AI Suggestion
                                </span>
                              </td>
                              <td className="text-xs text-foreground font-medium p-2 border-r border-border">
                                {r.product_spec}
                              </td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(r.suggested_quantity)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(r.suggested_amount_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(r.suggested_freight_cost)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(r.suggested_cogs)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(r.predicted_net_sales)}</td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-primary">{formatNumber(r.predicted_gm_value)}</td>
                              <td className={`text-xs font-mono font-semibold text-right p-2 border-r border-border ${r.predicted_gm_percent && r.predicted_gm_percent < 0 ? "text-red-500" : "text-accent"}`}>
                                {formatPercent(r.predicted_gm_percent)}
                              </td>
                              <td className="text-xs text-center p-2 border-r border-border">
                                <Badge className={`px-2 py-0.5 text-[10px] ${
                                  r.action === "BOOST" ? "bg-green-600/10 text-green-600" :
                                  r.action === "REPLACE" ? "bg-orange-500/10 text-orange-500" :
                                  r.action === "REDUCE" ? "bg-yellow-600/10 text-yellow-600" :
                                  "bg-red-600/10 text-red-600"
                                }`}>
                                  {r.action}
                                </Badge>
                              </td>
                              <td className="text-xs font-mono text-right p-2 border-r border-border text-muted-foreground">
                                {formatConfidence(r.confidence_score)}
                              </td>
                              <td className="text-xs text-muted-foreground p-2 border-r border-border">
                                {r.replaced_from ?? "—"}
                              </td>
                              <td className="text-xs p-2 break-words min-w-[260px] text-muted-foreground italic">
                                {r.reason ?? "—"}
                              </td>
                            </tr>
                          )
                        })

                        // Spacer row between customers - bold border line
                        if (customerIdx < customers.length - 1) {
                          displayRows.push(
                            <tr key={`spacer-${customerIdx}`} className="border-t-2 border-primary/60">
                              <td colSpan={14} />
                            </tr>
                          )
                        }
                      })

                      return displayRows
                    }, [rows, recommendations])}
                </tbody>
                </table>
            </div>
            </div>

            {/* Pagination */}
            {Math.ceil(recommendations.length / ROWS_PER_PAGE) > 1 && (
            <div className="flex items-center justify-center gap-2 border-t border-border p-3 bg-card/50">
                <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, ["ai1"]: Math.max(0, (currentPage["ai1"] || 0) - 1) })} disabled={(currentPage["ai1"] || 0) === 0}>Prev</Button>
                <span className="text-xs text-muted-foreground">Page {(currentPage["ai1"] || 0) + 1} of {Math.max(1, Math.ceil(recommendations.length / ROWS_PER_PAGE))}</span>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage({ ...currentPage, ["ai1"]: Math.min(Math.max(1, Math.ceil(recommendations.length / ROWS_PER_PAGE)) - 1, (currentPage["ai1"] || 0) + 1) })} disabled={(currentPage["ai1"] || 0) === Math.max(0, Math.ceil(recommendations.length / ROWS_PER_PAGE) - 1)}>Next</Button>
            </div>
            )}
        </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
