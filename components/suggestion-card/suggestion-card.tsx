import * as React from "react"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { 
  Search,
  ChevronDown, 
  TrendingUp, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight, 
  Lightbulb, 
  Sparkles, 
  MountainSnow, 
  CircleDollarSign, 
  Wallet2,
  ArrowUpWideNarrow,       
  ArrowDownWideNarrow,     
  ArrowUpDown,
  ArrowDownAZ, 
  ArrowDownZA,
  Loader2,
} from "lucide-react"
import { ButtonGroup } from "@/components/ui/button-group"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner" // ← sesuaikan dengan library toast yang kamu pakai

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProductSnapshot {
  qty: number;
  sales: number;
  cogs: number;
  asp: number;
  gmPct: number;
}

export interface NextMonthProduct {
  spec: string;
  family: string;
  isPareto: boolean;
  lastMonthQty: number;
  lastMonthSales: number;
  lastMonthGmPct: number;
  lastMonthAsp: number;
  projQty: number;
  projSales: number;
  projCogs: number;
  projGmPct: number;
  projAsp: number;
  qtyChange?: number;
}

export interface NextMonthPlan {
  retainedProducts: NextMonthProduct[];
  shiftedInProducts: NextMonthProduct[];
  removedProducts: NextMonthProduct[];
  summary: {
    retainedCount: number;
    shiftedInCount: number;
    removedCount: number;
  };
}

export interface ShiftProductSide {
  spec: string;
  family: string;
  current: ProductSnapshot;
  projected: ProductSnapshot;
}

export interface ShiftDelta {
  asp: number;
  cogsPerUnit: number;
  gmPct: number;
}

export interface ShiftCard {
  shiftId: string;
  family: string;
  isPartial: boolean;
  fromProduct: ShiftProductSide;
  toProduct: ShiftProductSide;
  shift: {
    shiftedQty: number;
    salesFromShift: number;
    salesUplift: number;
  };
  delta: ShiftDelta;
}

export interface CustomerStrategy {
  customerId: string;
  historicalMonths: number;
  lastMonthRef?: string;
  currentPerformance: {
    nettSales: number;
    currentQty: number;
    currentGmPct: number;
    status: "On Target" | "Needs Optimization";
  };
  projectedPerformance: {
    projectedSales: number;
    projectedQty: number;
    projectedGmPct: number;
    targetGmPct: number;
    improvement: number;
  };
  nextMonthPlan: NextMonthPlan;
  productMixStrategy: {
    paretoInMix?: string[];
    reduceOrRenegotiate: string[];
    upsellExisting: string[];
    shiftCards: ShiftCard[];
    aiReasoning: string;
  };
}

export interface SimulateApiResponse {
  recommendations: CustomerStrategy[];
}

// ── FetchedProduct type ───────────────────────────────────────────────────────

interface FetchedProduct {
  id: string;
  product_name: string;
  family?: string;
  asp?: number;
  gmPct?: number;
}

// ── ProductOverrides state shape ──────────────────────────────────────────────
// { [customerId]: { [originalSpec]: FetchedProduct } }
type ProductOverrides = Record<string, Record<string, FetchedProduct>>

// ── Helper: build patched customer JSON ──────────────────────────────────────

function buildPatchedCustomer(
  customer: CustomerStrategy,
  overridesForCustomer: Record<string, FetchedProduct>
): CustomerStrategy {
  return {
    ...customer,
    productMixStrategy: {
      ...customer.productMixStrategy,
      shiftCards: customer.productMixStrategy.shiftCards.map(card => {
        const override = overridesForCustomer[card.toProduct.spec]
        if (!override) return card
        return {
          ...card,
          toProduct: {
            ...card.toProduct,
            spec: override.product_name,
            ...(override.family ? { family: override.family } : {}),
            projected: {
              ...card.toProduct.projected,
              ...(override.asp    !== undefined ? { asp: override.asp }     : {}),
              ...(override.gmPct  !== undefined ? { gmPct: override.gmPct } : {}),
            },
          },
        }
      }),
      // patch retainedProducts juga
      ...(customer.nextMonthPlan ? {} : {}), // placeholder jika nanti mau extend
    },
    nextMonthPlan: {
      ...customer.nextMonthPlan,
      retainedProducts: (customer.nextMonthPlan?.retainedProducts ?? []).map(prod => {
        const override = overridesForCustomer[prod.spec]
        if (!override) return prod
        return {
          ...prod,
          spec: override.product_name,
          ...(override.family  ? { family: override.family }        : {}),
          ...(override.asp     !== undefined ? { projAsp: override.asp }     : {}),
          ...(override.gmPct   !== undefined ? { projGmPct: override.gmPct } : {}),
        }
      }),
    },
  }
}

// ── ProjectedProductPopover ───────────────────────────────────────────────────

interface ProjectedProductPopoverProps {
  defaultLabel: string
  pillClassName?: string
  customerId: string
  originalSpec: string
  onSelect: (customerId: string, originalSpec: string, product: FetchedProduct) => void
}

// function ProjectedProductPopover({
//   defaultLabel,
//   pillClassName = "",
//   customerId,
//   originalSpec,
//   onSelect,
// }: ProjectedProductPopoverProps) {
//   const [open, setOpen] = React.useState(false)
//   const [loading, setLoading] = React.useState(false)
//   const [products, setProducts] = React.useState<FetchedProduct[]>([])
//   const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null)

//   const handleOpenChange = async (isOpen: boolean) => {
//     setOpen(isOpen)
//     // fetch hanya sekali (products masih kosong)
//     if (isOpen && products.length === 0) {
//       setLoading(true)
//       try {
//         // ── Ganti URL ini ke endpoint produk kamu ──────────────────────────
//         const res = await fetch("/api/products")
//         const json = await res.json()
//         setProducts(json.data ?? json ?? [])
//       } catch (err) {
//         toast.error("Gagal memuat produk", { description: String(err) })
//       } finally {
//         setLoading(false)
//       }
//     }
//   }

//   const handleSelect = (product: FetchedProduct) => {
//     setSelectedLabel(product.product_name)
//     setOpen(false)
//     onSelect(customerId, originalSpec, product)
//   }

//   return (
//     <Popover open={open} onOpenChange={handleOpenChange}>
//       <PopoverTrigger asChild>
//         <button
//           className={`text-[11px] font-bold text-center border rounded-md px-1.5 py-0.5 flex-1 min-w-0 truncate cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all ${pillClassName}`}
//           title="Klik untuk pilih produk lain"
//         >
//           {selectedLabel ?? defaultLabel}
//         </button>
//       </PopoverTrigger>

//       <PopoverContent className="w-64 p-0" align="start" side="bottom">
//         <Command>
//           <CommandInput placeholder="Cari produk..." />
//           <CommandList>
//             {loading && (
//               <div className="flex items-center justify-center py-4 gap-2 text-xs text-muted-foreground">
//                 <Loader2 className="w-4 h-4 animate-spin" /> Memuat produk…
//               </div>
//             )}
//             {!loading && <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>}
//             {!loading && products.length > 0 && (
//               <CommandGroup>
//                 {products.map(p => (
//                   <CommandItem
//                     key={p.id}
//                     value={p.product_name}
//                     onSelect={() => handleSelect(p)}
//                     className="text-xs"
//                   >
//                     {p.product_name}
//                   </CommandItem>
//                 ))}
//               </CommandGroup>
//             )}
//           </CommandList>
//         </Command>
//       </PopoverContent>
//     </Popover>
//   )
// }

// ── Props ─────────────────────────────────────────────────────────────────────
function ProjectedProductPopover({
  defaultLabel,
  pillClassName = "",
  customerId,
  originalSpec,
  onSelect,
}: ProjectedProductPopoverProps) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [products, setProducts] = React.useState<FetchedProduct[]>([])

  const handleOpenChange = async (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen && products.length === 0) {
      setLoading(true)
      try {
        const res = await fetch("/api/products")
        const json = await res.json()
        setProducts(json.data ?? json ?? [])
      } catch (err) {
        toast.error("Gagal memuat produk", { description: String(err) })
      } finally {
        setLoading(false)
      }
    }
  }

  const handleSelect = (product: FetchedProduct) => {
    setOpen(false)
    onSelect(customerId, originalSpec, product)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={`text-[11px] font-bold text-center border rounded-md px-1.5 py-0.5 flex-1 min-w-0 truncate cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all ${pillClassName}`}
          title="Klik untuk pilih produk lain"
        >
          {/* Ini sekarang murni ngikutin data dari atasannya */}
          {defaultLabel} 
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-0" align="start" side="bottom">
        <Command>
          <CommandInput placeholder="Cari produk..." />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-4 gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Memuat produk…
              </div>
            )}
            {!loading && <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>}
            {!loading && products.length > 0 && (
              <CommandGroup>
                {products.map(p => (
                  <CommandItem
                    key={p.id}
                    value={p.product_name}
                    onSelect={() => handleSelect(p)}
                    className="text-xs"
                  >
                    {p.product_name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface Props {
  data: CustomerStrategy[];
}

type SortKey = "GM" | "CUSTOMER" | "SELLING_PRICE" | null;
type SortOrder = "asc" | "desc";

// ── Main Component ────────────────────────────────────────────────────────────

export function CustomerStrategyCarousel({ data = [] }: Props) {
  const safeData = Array.isArray(data) ? data : [];

  // ── Sorting & Search ──────────────────────────────────────────────────────
  const [sortKey, setSortKey] = React.useState<SortKey>(null);
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("desc");
  const [searchQuery, setSearchQuery] = React.useState("");

  // ── Product Overrides (lifted state) ─────────────────────────────────────
  const [productOverrides, setProductOverrides] = React.useState<ProductOverrides>({})

  // ── Handler: user pilih produk baru ──────────────────────────────────────
  const handleProductSelect = React.useCallback(async (
  customerId: string,
  originalSpec: string,
  selectedProduct: FetchedProduct
) => {
  // 1. Simpan nilai lama untuk antisipasi rollback
  const previousCustomerOverrides = productOverrides[customerId] ?? {};
  const previousValue = previousCustomerOverrides[originalSpec];

  const customer = safeData.find(c => c.customerId === customerId);
  if (!customer) return;

  // 2. Siapkan data baru
  const updatedCustomerOverrides = {
    ...previousCustomerOverrides,
    [originalSpec]: selectedProduct,
  };
  const patched_data = buildPatchedCustomer(customer, updatedCustomerOverrides);

  // 3. Update State secara Optimis (Dropdown berubah langsung)
  setProductOverrides(prev => ({
    ...prev,
    [customerId]: updatedCustomerOverrides,
  }));

  try {
    const aiResponse = await fetch(`${process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL_AI_PRODUCT_CUSTOMER}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patched_data }),
    });

    if (!aiResponse.ok) {
      throw new Error("Gagal kalkulasi di server");
    }

    toast.success(`Produk berhasil diupdate & direkalkulasi`);

  } catch (error) {
    console.error("Re-calculation failed:", error);

    // 4. ROLLBACK: Jika gagal, kembalikan ke nilai semula
    setProductOverrides(prev => ({
      ...prev,
      [customerId]: {
        ...(prev[customerId] ?? {}),
        [originalSpec]: previousValue, // Kembali ke null atau nilai lama
      },
    }));

    toast.error("Gagal melakukan kalkulasi AI", {
      description: "Pilihan produk telah dibatalkan otomatis.",
    });
  }
}, [safeData, productOverrides]);
  
  // ── Sort handler ──────────────────────────────────────────────────────────
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const processedData = React.useMemo(() => {
    let filteredData = safeData;
    if (searchQuery.trim() !== "") {
      const lowerQuery = searchQuery.toLowerCase();
      filteredData = safeData.filter(item =>
        item.customerId.toLowerCase().includes(lowerQuery)
      );
    }
    if (!sortKey) return filteredData;
    return [...filteredData].sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;
      if (sortKey === "GM") {
        valA = a.projectedPerformance?.projectedGmPct || 0;
        valB = b.projectedPerformance?.projectedGmPct || 0;
      } else if (sortKey === "CUSTOMER") {
        valA = a.customerId.toLowerCase();
        valB = b.customerId.toLowerCase();
      } else if (sortKey === "SELLING_PRICE") {
        valA = a.projectedPerformance?.projectedQty > 0
          ? a.projectedPerformance.projectedSales / a.projectedPerformance.projectedQty
          : 0;
        valB = b.projectedPerformance?.projectedQty > 0
          ? b.projectedPerformance.projectedSales / b.projectedPerformance.projectedQty
          : 0;
      }
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [safeData, sortKey, sortOrder, searchQuery]);

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3.5 w-3.5" />;
    if (key === "CUSTOMER") {
      return sortOrder === "asc"
        ? <ArrowDownAZ className="h-3.5 w-3.5" />
        : <ArrowDownZA className="h-3.5 w-3.5" />;
    }
    return sortOrder === "asc"
      ? <ArrowUpWideNarrow className="h-3.5 w-3.5" />
      : <ArrowDownWideNarrow className="h-3.5 w-3.5" />;
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(value)

  // ── Executive Summary calculations ────────────────────────────────────────
  let totalSales = 0;
  let totalCurrentGmValue = 0;
  let totalProjectedGmValue = 0;
  let totalQty = 0;
  let totalProjectedQty = 0;
  let totalProjectedSales = 0;

  safeData.forEach(item => {
    const sales = item.currentPerformance.nettSales;
    totalSales += sales;
    totalCurrentGmValue += sales * (item.currentPerformance.currentGmPct / 100);
    totalProjectedGmValue += sales * (item.projectedPerformance.projectedGmPct / 100);
    totalQty += item.currentPerformance.currentQty || 0;
    totalProjectedQty += item.projectedPerformance.projectedQty || 0;
    totalProjectedSales += item.projectedPerformance.projectedSales || 0;
  });

  const avgCurrentGmPct = totalSales > 0 ? (totalCurrentGmValue / totalSales) * 100 : 0;
  const avgProjectedGmPct = totalSales > 0 ? (totalProjectedGmValue / totalSales) * 100 : 0;
  const projectedSales = totalProjectedSales;
  const projectedGmValue = totalProjectedGmValue;
  const totalCurrentGMValue = totalCurrentGmValue;
  const avgSellingPrice = totalQty > 0 ? totalSales / totalQty : 0;
  const projectedAvgSellingPrice = totalProjectedQty > 0 ? totalProjectedSales / totalProjectedQty : 0;

  const getGmColor = (gm: number) => {
    if (gm < -9) return 'text-destructive';
    if (gm < 0) return 'text-orange-500';
    if (gm <= 9) return 'text-blue-600';
    return 'text-emerald-600';
  };

  return (
    <div className="space-y-6">

      {/* ── Executive Summary ─────────────────────────────────────────────── */}
      {safeData.length > 0 && (() => {
        const getCardTheme = (gm: number) => {
          if (gm < -9) return { card: "bg-red-500/10 border-red-500/20", label: "text-red-400", value: "text-red-500", icon: "text-red-500" };
          if (gm < 0)  return { card: "bg-orange-500/10 border-orange-500/20", label: "text-orange-400", value: "text-orange-500", icon: "text-orange-500" };
          if (gm <= 9) return { card: "bg-blue-500/10 border-blue-500/20", label: "text-blue-400", value: "text-blue-500", icon: "text-blue-500" };
          return { card: "bg-emerald-500/10 border-emerald-500/20", label: "text-emerald-400", value: "text-emerald-500", icon: "text-emerald-500" };
        };
        const currentTheme   = getCardTheme(avgCurrentGmPct);
        const projectedTheme = getCardTheme(avgProjectedGmPct);

        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-b pb-6 mb-6 border-primary/50">
            <h1 className="text-2xl font-bold text-primary/90 col-span-full">Executive Summary</h1>

            <Card size="sm" className="col-span-2 md:col-span-1 bg-primary/90 border-primary/20 shadow-sm">
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10"><CircleDollarSign size={90} className="text-white text-fluid-sm"/></div>
                <span className="text-fluid-xs text-slate-200 font-semibold uppercase tracking-wider mb-1">Current Nett Sales</span>
                <span className="text-fluid-lg font-bold text-slate-100">{formatCurrency(totalSales)}</span>
              </CardContent>
            </Card>

            <Card size="sm" className={`shadow-sm ${currentTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10"><MountainSnow className={`w-20 h-20 ${currentTheme.icon}`} /></div>
                <span className={`text-fluid-xs font-semibold uppercase tracking-wider ${currentTheme.label}`}>Current Global GM%</span>
                <span className={`text-fluid-lg font-bold z-10 ${currentTheme.value}`}>{avgCurrentGmPct.toFixed(2)}%</span>
              </CardContent>
            </Card>

            <Card size="sm" className={`shadow-sm ${currentTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10"><Wallet2 className={`w-20 h-20 ${currentTheme.icon}`} /></div>
                <span className={`text-fluid-xs font-semibold uppercase tracking-wider mb-1 ${currentTheme.label}`}>Current Global GM Value</span>
                <span className={`text-fluid-lg font-bold z-10 ${currentTheme.value}`}>{formatCurrency(totalCurrentGMValue)}</span>
              </CardContent>
            </Card>

            <Card size="sm" className={`col-span-2 md:col-span-1 shadow-sm ${currentTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10"><Wallet2 className={`w-20 h-20 ${currentTheme.icon}`} /></div>
                <span className={`text-fluid-xs font-semibold uppercase tracking-wider mb-1 ${currentTheme.label}`}>Current Average Selling Price</span>
                <span className={`text-fluid-lg font-bold z-10 ${currentTheme.value}`}>{formatCurrency(avgSellingPrice)}</span>
              </CardContent>
            </Card>

            <Card size="sm" className={`col-span-2 md:col-span-1 shadow-sm ${projectedTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10"><CircleDollarSign size={90} className={projectedTheme.icon}/></div>
                <span className={`text-fluid-xs font-semibold uppercase tracking-wider mb-1 ${projectedTheme.label}`}>Projected Nett Sales</span>
                <span className={`text-fluid-lg font-bold z-10 ${projectedTheme.value}`}>{formatCurrency(projectedSales)}</span>
              </CardContent>
            </Card>

            <Card size="sm" className={`shadow-sm ${projectedTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10"><Sparkles className={`w-20 h-20 ${projectedTheme.icon}`} /></div>
                <span className={`text-fluid-xs font-semibold uppercase tracking-wider z-10 ${projectedTheme.label}`}>Projected Global GM%</span>
                <span className={`text-fluid-lg font-bold z-10 ${projectedTheme.value}`}>{avgProjectedGmPct.toFixed(2)}%</span>
              </CardContent>
            </Card>

            <Card size="sm" className={`shadow-sm ${projectedTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10"><Wallet2 className={`w-20 h-20 ${projectedTheme.icon}`} /></div>
                <span className={`text-fluid-xs font-semibold uppercase tracking-wider z-10 ${projectedTheme.label}`}>Projected Global GM Value</span>
                <span className={`text-fluid-lg font-bold z-10 ${projectedTheme.value}`}>{formatCurrency(projectedGmValue)}</span>
              </CardContent>
            </Card>

            <Card size="sm" className={`col-span-2 md:col-span-1 shadow-sm ${projectedTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10"><Wallet2 className={`w-20 h-20 ${projectedTheme.icon}`} /></div>
                <span className={`text-fluid-xs font-semibold uppercase tracking-wider z-10 ${projectedTheme.label}`}>Projected Average Selling Price</span>
                <span className={`text-fluid-lg font-bold z-10 ${projectedTheme.value}`}>{formatCurrency(projectedAvgSellingPrice)}</span>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* ── Search & Sort ─────────────────────────────────────────────────── */}
      <div className="col-span-full flex flex-col md:flex-row justify-between items-center gap-4 mt-4">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search Customer..."
            className="pl-9 bg-background border-primary/20 focus-visible:ring-primary"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <>
          {/* Mobile: Dropdown */}
          <div className="md:hidden w-full">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="w-full text-fluid-xs gap-2 text-primary">
                  <ArrowUpDown className="w-3 h-3" />
                  {sortKey === "GM" ? "Sort By GM"
                    : sortKey === "CUSTOMER" ? "Sort By Customer"
                    : sortKey === "SELLING_PRICE" ? "Sort By Selling Price"
                    : "Sort By"}
                  <ChevronDown className="w-3 h-3 ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-full">
                <DropdownMenuItem onClick={() => handleSort("GM")} className={`gap-2 ${sortKey === "GM" ? "text-primary font-semibold" : ""}`}>
                  {renderSortIcon("GM")} Sort By Projected GM
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSort("CUSTOMER")} className={`gap-2 ${sortKey === "CUSTOMER" ? "text-primary font-semibold" : ""}`}>
                  {renderSortIcon("CUSTOMER")} Sort By Customer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSort("SELLING_PRICE")} className={`gap-2 ${sortKey === "SELLING_PRICE" ? "text-primary font-semibold" : ""}`}>
                  {renderSortIcon("SELLING_PRICE")} Sort By Projected Selling Price
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Desktop: ButtonGroup */}
          <ButtonGroup className="hidden md:flex w-auto justify-end">
            <Button variant="outline" size="sm" onClick={() => handleSort("GM")}
              className={`text-fluid-xs gap-2 ${sortKey === "GM" ? "bg-primary text-primary-foreground hover:bg-primary/80" : "bg-transparent text-primary hover:bg-primary/10"}`}>
              {renderSortIcon("GM")} Projected GM
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleSort("CUSTOMER")}
              className={`text-fluid-xs gap-2 ${sortKey === "CUSTOMER" ? "bg-primary text-primary-foreground hover:bg-primary/80" : "bg-transparent text-primary hover:bg-primary/10"}`}>
              {renderSortIcon("CUSTOMER")} Customer
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleSort("SELLING_PRICE")}
              className={`text-fluid-xs gap-2 ${sortKey === "SELLING_PRICE" ? "bg-primary text-primary-foreground hover:bg-primary/80" : "bg-transparent text-primary hover:bg-primary/10"}`}>
              {renderSortIcon("SELLING_PRICE")} Projected Selling Price
            </Button>
          </ButtonGroup>
        </>
      </div>

      {/* ── Carousel ──────────────────────────────────────────────────────── */}
      <Carousel opts={{ align: "start", watchResize: true, watchSlides: false }} className="w-full">
        <CarouselContent>
          {processedData.map((customer, index) => {
            const isNeedsOpt = customer.currentPerformance.status === "Needs Optimization"
            const improvement = customer.projectedPerformance?.improvement || 0
            const currentGmGlobal = customer.currentPerformance.currentGmPct;
            const projectedGmGlobal = customer.projectedPerformance.projectedGmPct;

            return (
              <CarouselItem key={`${customer.customerId}-${index}`} className="min-w-0 shrink-0 basis-full sm:basis-1/1 md:basis-1/2 2xl:basis-1/3 xl:basis-1/2 pl-4">
                <Card className="h-full flex flex-col shadow-sm border border-card-border bg-primary/3 [content-visibility:auto]">
                  <CardHeader className="pb-3 border-b">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-lg font-bold">{customer.customerId}</CardTitle>
                      <Badge variant={isNeedsOpt ? "destructive" : "default"} className="text-[10px] px-2 shrink-0 whitespace-nowrap">
                        {isNeedsOpt ? <AlertCircle className="w-3 h-3 mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                        {customer.currentPerformance.status}
                      </Badge>
                    </div>

                    {/* Summary GM Box */}
                    <div className="flex items-start gap-2 mt-3 p-2 bg-primary/15 rounded-md border shadow-sm">
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[8px] uppercase tracking-wider font-semibold">Current</span>
                        <span className="text-xs font-bold">
                          GM: <span className={getGmColor(currentGmGlobal)}>{currentGmGlobal.toFixed(2)}%</span>
                        </span>
                        <span className="text-[10px] font-medium">
                          Nett. Sales: <span className={getGmColor(currentGmGlobal)}>{formatCurrency(customer.currentPerformance.nettSales)}</span>
                        </span>
                        <span className="text-[10px] font-medium">
                          Qty: <span className={getGmColor(currentGmGlobal)}>{customer.currentPerformance.currentQty.toFixed(2)}</span>
                        </span>
                      </div>

                      <ArrowRight className="w-3 h-3 shrink-0 mt-3" />

                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[8px] uppercase tracking-wider font-semibold">Projected</span>
                        <span className={`text-xs font-bold ${getGmColor(projectedGmGlobal)}`}>{projectedGmGlobal.toFixed(2)}%</span>
                        <span className={`text-[10px] font-bold truncate ${getGmColor(projectedGmGlobal)}`}>
                          {formatCurrency(customer.projectedPerformance.projectedSales)}
                        </span>
                        <span className={`text-[10px] font-bold ${getGmColor(projectedGmGlobal)}`}>
                          {customer.projectedPerformance.projectedQty}
                        </span>
                      </div>

                      {improvement > 0 && (
                        <div className="flex flex-col gap-0.5 items-end shrink-0">
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] font-bold px-1 py-0 whitespace-nowrap">
                            +{improvement.toFixed(2)}%
                          </Badge>
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] font-bold px-1 py-0 whitespace-nowrap">
                            +{formatCurrency(customer.projectedPerformance.projectedSales - customer.currentPerformance.nettSales)}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 flex flex-col gap-4 mt-4">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary/90 uppercase tracking-tight">
                      <TrendingUp className="w-3.5 h-3.5" /> Recommendation
                    </div>

                    <ScrollArea className="h-[420px] pr-4">
                      <div className="space-y-5">
                        {(customer.productMixStrategy?.shiftCards?.length > 0 ||
                          customer.nextMonthPlan?.retainedProducts?.length > 0 ||
                          customer.nextMonthPlan?.removedProducts?.length > 0) && (
                          <div className="space-y-2">
                            {(() => {
                              // const shiftCards      = customer.productMixStrategy?.shiftCards || [];
                              // const retainedProducts = customer.nextMonthPlan?.retainedProducts || [];
                              // const removedProducts  = customer.nextMonthPlan?.removedProducts || [];
                              const shiftCards = customer.productMixStrategy?.shiftCards || [];
                              const retainedProducts = customer.nextMonthPlan?.retainedProducts || [];

                              // BIKIN FILTER DISINI: Ambil semua nama produk yang udah jadi korban "Product Switch"
                              const shiftedFromSpecs = shiftCards.map(card => card.fromProduct.spec);

                              // FILTER REMOVED: Hanya tampilkan produk Removed JIKA dia tidak ada di dalam list Product Switch
                              const removedProducts = (customer.nextMonthPlan?.removedProducts || []).filter(
                                prod => !shiftedFromSpecs.includes(prod.spec)
                              );
                              type RenderItem = {
                                type: 'shifted' | 'retained' | 'removed';
                                badgeLabel: string;
                                badgeClass: string;
                                source: { spec: string; current: { gmPct: number; sales: number; qty: number; asp: number } };
                                target: { projected: { gmPct: number; sales: number; qty: number; asp: number } };
                                uplift: number;
                                displayQty: number;
                                displaySales: number;
                                targetSpecDisplay: string;
                                targetSpecClass: string;
                              }

                              const renderItems: RenderItem[] = [];

                              shiftCards.forEach(card => {
                                renderItems.push({
                                  type: 'shifted',
                                  badgeLabel: '🔄 Product Switch',
                                  badgeClass: 'bg-primary text-primary-foreground border-primary shadow-sm',
                                  source: card.fromProduct,
                                  target: card.toProduct,
                                  uplift: card.shift.salesUplift,
                                  displayQty: card.shift.shiftedQty,
                                  displaySales: card.shift.salesFromShift,
                                  targetSpecDisplay: card.toProduct.spec,
                                  targetSpecClass: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
                                });
                              });

                              retainedProducts.forEach(prod => {
                                renderItems.push({
                                  type: 'retained',
                                  badgeLabel: '✅ No Change',
                                  badgeClass: 'bg-secondary-foreground text-secondary border-border shadow-sm',
                                  source: {
                                    spec: prod.spec,
                                    current: {
                                      gmPct: prod.lastMonthGmPct || prod.projGmPct,
                                      sales: prod.lastMonthSales || prod.projSales,
                                      qty:   prod.lastMonthQty   || prod.projQty,
                                      asp:   prod.lastMonthAsp   || prod.projAsp,
                                    }
                                  },
                                  target: {
                                    projected: {
                                      gmPct: prod.projGmPct,
                                      sales: prod.projSales,
                                      qty:   prod.projQty,
                                      asp:   prod.projAsp,
                                    }
                                  },
                                  uplift: 0,
                                  displayQty: prod.projQty,
                                  displaySales: prod.projSales,
                                  targetSpecDisplay: 'No Change',
                                  targetSpecClass: 'text-slate-200 bg-slate-800 border-slate-700',
                                });
                              });

                              removedProducts.forEach(prod => {
                                renderItems.push({
                                  type: 'removed',
                                  badgeLabel: '❌ Removed',
                                  badgeClass: 'bg-destructive/10 text-destructive border-destructive/20 shadow-sm',
                                  source: {
                                    spec: prod.spec,
                                    current: { gmPct: prod.lastMonthGmPct, sales: prod.lastMonthSales, qty: prod.lastMonthQty, asp: prod.lastMonthAsp }
                                  },
                                  target: {
                                    projected: { gmPct: prod.projGmPct, sales: prod.projSales, qty: prod.projQty, asp: prod.projAsp }
                                  },
                                  uplift: 0,
                                  displayQty: prod.projQty,
                                  displaySales: prod.projSales,
                                  targetSpecDisplay: 'Removed',
                                  targetSpecClass: 'text-destructive bg-destructive/10 border-destructive/20',
                                });
                              });

                              return renderItems
                                .sort((a, b) => {
                                  const order = { shifted: 1, retained: 2, removed: 3 };
                                  return order[a.type] - order[b.type];
                                })
                                .map((item, idx) => {
                                  const isShifted  = item.type === 'shifted';
                                  const isRemoved  = item.type === 'removed';
                                  const currentGm  = item.source.current.gmPct;
                                  const projectedGm = item.target.projected.gmPct;
                                  const currentSales = item.source.current.sales;
                                  const currentQty   = item.source.current.qty;

                                  return (
                                    <div key={idx} className={`flex flex-col p-2 border rounded-md relative mt-3 hover:shadow-md transition-colors ${
                                      isRemoved ? 'bg-destructive/5 border-destructive/20' : 'bg-primary/9 border-border'
                                    }`}>

                                      <Badge
                                        variant="secondary"
                                        className={`text-[9px] px-1.5 py-0 whitespace-nowrap mb-2 w-fit border absolute -top-2.5 left-2 ${item.badgeClass}`}
                                      >
                                        {item.badgeLabel}
                                      </Badge>

                                      {/* Product pills */}
                                      <div className="flex items-center justify-between gap-1.5 mb-2 mt-1">
                                        {/* FROM pill — tidak clickable */}
                                        <span className={`text-[11px] font-bold text-center rounded-md px-1.5 py-0.5 flex-1 min-w-0 truncate ${
                                          currentGm < 9
                                            ? 'text-destructive bg-destructive/10 border border-destructive/20'
                                            : 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20'
                                        }`}>
                                          {item.source.spec}
                                        </span>

                                        <ArrowRight className={`w-3 h-3 shrink-0 ${!isShifted || isRemoved ? 'text-slate-600/30' : 'text-slate-400'}`} />

                                        {/* TO pill — clickable (kecuali removed) */}
                                        {/* TO pill — clickable (kecuali removed) */}
                                        {isRemoved ? (
                                          <span className={`text-[11px] font-bold text-center border rounded-md px-1.5 py-0.5 flex-1 min-w-0 truncate ${item.targetSpecClass}`}>
                                            {item.targetSpecDisplay}
                                          </span>
                                        ) : (
                                          <ProjectedProductPopover
                                            // BAGIAN INI YANG BIKIN BISA ROLLBACK: 
                                            // "Tampilin product barunya kalau ada, kalau gagal balik ke nama aslinya"
                                            defaultLabel={productOverrides[customer.customerId]?.[item.targetSpecDisplay]?.product_name ?? item.targetSpecDisplay}
                                            pillClassName={item.targetSpecClass}
                                            customerId={customer.customerId}
                                            originalSpec={item.targetSpecDisplay}
                                            onSelect={handleProductSelect}
                                          />
                                        )}
                                      </div>

                                      {/* Current vs Projected grid */}
                                      <div className="grid grid-cols-2 gap-2 relative">
                                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-700/30" />

                                        {/* Kolom kiri — Current */}
                                        <div className="flex flex-col gap-0.5 pr-1.5">
                                          <span className="text-[8px] uppercase tracking-wider font-semibold">Current</span>
                                          <span className="text-[11px] font-bold">
                                            GM: <span className={getGmColor(currentGm)}>{currentGm.toFixed(2)}%</span>
                                          </span>
                                          <span className="text-[10px]">Sales: <span className={getGmColor(currentGm)}>{formatCurrency(currentSales)}</span></span>
                                          <span className="text-[10px]">Qty: <span className={getGmColor(currentGm)}>{Number(currentQty).toFixed(2)}</span></span>
                                          <span className="text-[10px]">Price: <span className={getGmColor(currentGm)}>{formatCurrency(item.source.current.asp)}</span></span>
                                        </div>

                                        {/* Kolom kanan — Projected */}
                                        <div className="flex flex-col gap-0.5 pl-1.5">
                                          <span className="text-[8px] uppercase tracking-wider font-semibold">Projected</span>

                                          <div className="flex flex-wrap items-center gap-1">
                                            <span className={`text-[11px] font-bold ${isRemoved ? 'text-slate-500' : getGmColor(projectedGm)}`}>
                                              {projectedGm.toFixed(2)}%
                                            </span>
                                            {isShifted && (
                                              <Badge variant="outline" className={`px-1 py-0 text-[8px] font-bold whitespace-nowrap ${getGmColor(projectedGm)} bg-emerald-500/10 border-emerald-500/20`}>
                                                {(projectedGm - currentGm) > 0 ? '+' : ''}{(projectedGm - currentGm).toFixed(2)}%
                                              </Badge>
                                            )}
                                          </div>

                                          <div className="flex flex-wrap items-center gap-1">
                                            <span className={`text-[10px] ${isRemoved ? 'text-slate-500' : getGmColor(projectedGm)}`}>
                                              {formatCurrency(item.displaySales)}
                                            </span>
                                            {isShifted && (
                                              <Badge variant="outline" className={`px-1 py-0 text-[8px] font-bold whitespace-nowrap ${getGmColor(projectedGm)} bg-emerald-500/10 border-emerald-500/20`}>
                                                {item.uplift < 0 ? '-' : '+'}{formatCurrency(Math.abs(item.uplift))}
                                              </Badge>
                                            )}
                                          </div>

                                          <span className={`text-[10px] ${isRemoved ? 'text-slate-500' : getGmColor(projectedGm)}`}>
                                            {Number(item.displayQty).toFixed(2)}
                                          </span>
                                          <span className={`text-[10px] ${isRemoved ? 'text-slate-500' : getGmColor(projectedGm)}`}>
                                            {formatCurrency(item.target.projected.asp)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                });
                            })()}
                          </div>
                        )}
                      </div>
                    </ScrollArea>

                    {customer.productMixStrategy.aiReasoning && (
                      <div className="bg-primary/5 p-3 rounded-md border border-primary/20 flex items-start gap-2 max-w-[96%]">
                        <Lightbulb className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <ScrollArea className="h-[420px] pr-4">
                          <div className="text-xs leading-relaxed font-medium space-y-1.5 w-full">
                            {customer.productMixStrategy.aiReasoning
                              .split('\n')
                              .flatMap(line => line.split(/(?=\d+\.\s)/))
                              .map(line => line.replace(/\*\*/g, '').replace(/#/g, '').trim())
                              .filter(line => line.length > 0)
                              .map((line, idx) => {
                                const isNumbered = /^\d+\./.test(line);
                                return (
                                  <div key={idx} className={`italic ${isNumbered ? 'flex gap-1.5 ml-2' : 'font-semibold opacity-80 mb-2'}`}>
                                    {isNumbered ? (
                                      <>
                                        <span className="font-bold text-primary">{line.match(/^\d+\./)?.[0]}</span>
                                        <span className="opacity-90">{line.replace(/^\d+\.\s/, '').replace(/"/g, '')}</span>
                                      </>
                                    ) : (
                                      <span>{line}</span>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </CarouselItem>
            )
          })}
        </CarouselContent>

        <CarouselPrevious className="sticky-center left-0 -translate-x-1/2 bg-slate-900 text-slate-300 shadow-md border border-slate-700 hover:bg-slate-800 z-10 w-8 h-8" />
        <CarouselNext className="sticky-center right-0 translate-x-1/2 bg-slate-900 text-slate-300 shadow-md border border-slate-700 hover:bg-slate-800 z-10 w-8 h-8" />
      </Carousel>
    </div>
  )
}

// import * as React from "react"
// import {
//   Popover,
//   PopoverContent,
//   PopoverTrigger,
// } from "@/components/ui/popover"
// import {
//   Command,
//   CommandEmpty,
//   CommandGroup,
//   CommandInput,
//   CommandItem,
//   CommandList,
// } from "@/components/ui/command"
// import {
//   Carousel,
//   CarouselContent,
//   CarouselItem,
//   CarouselNext,
//   CarouselPrevious,
// } from "@/components/ui/carousel"
// import {
//   Card,
//   CardContent,
//   CardHeader,
//   CardTitle,
// } from "@/components/ui/card"
// import { Badge } from "@/components/ui/badge"
// import { ScrollArea } from "@/components/ui/scroll-area"
// import { 
//   Search,
//   ChevronDown, 
//   TrendingUp, 
//   AlertCircle, 
//   CheckCircle2, 
//   ArrowRight, 
//   Lightbulb, 
//   Sparkles, 
//   MountainSnow, 
//   CircleDollarSign, 
//   Wallet2,
//   ArrowUpWideNarrow,       
//   ArrowDownWideNarrow,     
//   ArrowUpDown,
//   ArrowDown01, 
//   ArrowDown10, 
//   ArrowDownAZ, 
//   ArrowDownZA,    
//   Loader2
// } from "lucide-react"
// import { ButtonGroup } from "@/components/ui/button-group"
// import { Button } from "@/components/ui/button"
// import { Input } from "@/components/ui/input"
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuTrigger,
// } from "@/components/ui/dropdown-menu"
// import { toast } from "sonner"

// // ── Snapshot per produk (dipakai di current & projected) ─────────────────────
// export interface ProductSnapshot {
//   qty: number;
//   sales: number;
//   cogs: number;
//   asp: number;      // Average Selling Price
//   gmPct: number;
// }

// // ── Interface Baru untuk nextMonthPlan ───────────────────────────────────────
// export interface NextMonthProduct {
//   spec: string;
//   family: string;
//   isPareto: boolean;
//   lastMonthQty: number;
//   lastMonthSales: number;
//   lastMonthGmPct: number;
//   lastMonthAsp: number;
//   projQty: number;
//   projSales: number;
//   projCogs: number;
//   projGmPct: number;
//   projAsp: number;
//   qtyChange?: number;
// }

// export interface NextMonthPlan {
//   retainedProducts: NextMonthProduct[];
//   shiftedInProducts: NextMonthProduct[];
//   removedProducts: NextMonthProduct[];
//   summary: {
//     retainedCount: number;
//     shiftedInCount: number;
//     removedCount: number;
//   };
// }

// // ── Satu sisi produk dalam shift card (from atau to) ─────────────────────────
// export interface ShiftProductSide {
//   spec: string;
//   family: string;
//   current: ProductSnapshot;    // kondisi sebelum shift
//   projected: ProductSnapshot;  // kondisi setelah shift
// }

// // ── Delta unit economics antara TO vs FROM ────────────────────────────────────
// export interface ShiftDelta {
//   asp: number;          // positif → TO lebih mahal per unit
//   cogsPerUnit: number;  // positif → TO cogs lebih tinggi per unit
//   gmPct: number;        // positif → TO punya margin lebih tinggi ✓
// }

// // ── Satu shift card = satu pasangan from→to ───────────────────────────────────
// export interface ShiftCard {
//   shiftId: string;     // format: "{fromSpec}__to__{toSpec}"
//   family: string;
//   isPartial: boolean;  // true = hanya sebagian qty yang dishift

//   fromProduct: ShiftProductSide;
//   toProduct: ShiftProductSide;

//   shift: {
//     shiftedQty: number;      // volume yang dipindahkan
//     salesFromShift: number;  // revenue dari qty yang pindah (harga TO)
//     salesUplift: number;     // net gain revenue (salesFromShift - revenue yang hilang dari FROM)
//   };

//   delta: ShiftDelta;
// }

// export interface CustomerStrategy {
//   customerId: string;
//   historicalMonths: number;
//   lastMonthRef?: string; // Tambahan dari JSON

//   currentPerformance: {
//     nettSales: number;
//     currentQty: number;
//     currentGmPct: number;
//     status: "On Target" | "Needs Optimization";
//   };

//   projectedPerformance: {
//     projectedSales: number;
//     projectedQty: number;
//     projectedGmPct: number;
//     targetGmPct: number;
//     improvement: number;
//   };

//   nextMonthPlan: NextMonthPlan; // <--- Masukkan ke sini

//   productMixStrategy: {
//     paretoInMix?: string[];
//     reduceOrRenegotiate: string[];
//     upsellExisting: string[];
//     shiftCards: ShiftCard[];
//     aiReasoning: string;
//   };
// }

// export interface SimulateApiResponse {
//   recommendations: CustomerStrategy[];
// }

// interface Props {
//   data: CustomerStrategy[];
// }

// // ══════════════════════════════════════════════════════════════
// // SUB-KOMPONEN BARU — taruh di luar CustomerStrategyCarousel
// // ══════════════════════════════════════════════════════════════

// interface FetchedProduct {
//   id: string
//   product_name: string
//   family?: string
//   asp?: number
//   gmPct?: number
// }

// interface ProjectedProductPopoverProps {
//   /** Label yang ditampilkan di pill sebelum user pilih */
//   defaultLabel: string
//   /** Class tambahan untuk pill */
//   pillClassName?: string
//   /** Konteks customer — dikirim ke toast */
//   customerId: string
// }

// function ProjectedProductPopover({
//   defaultLabel,
//   pillClassName = "",
//   customerId,
// }: ProjectedProductPopoverProps) {
//   const [open, setOpen] = React.useState(false)
//   const [loading, setLoading] = React.useState(false)
//   const [products, setProducts] = React.useState<FetchedProduct[]>([])
//   const [selected, setSelected] = React.useState<FetchedProduct | null>(null)
  
//   // Fetch products saat popover dibuka (hanya sekali)
//   const handleOpenChange = async (isOpen: boolean) => {
//     setOpen(isOpen)
//     if (isOpen && products.length === 0) {
//       setLoading(true)
//       try {
//         // ── Ganti URL ini ke endpoint produk kamu ──────────────────
//         const res = await fetch("/api/products")          
//         // Kalau belum ada endpoint, pakai mock:
//         // const res = await fakeFetchProducts()
//         const json = await res.json()
//         // Sesuaikan field-name dengan response API kamu
//         setProducts(json.data ?? json ?? [])
//       } catch (err) {
//         toast.error("Gagal memuat produk", {
//           description: String(err),
//         })
//       } finally {
//         setLoading(false)
//       }
//     }
//   }

//   const handleSelect = (product: FetchedProduct) => {
//     setSelected(product)
//     setOpen(false)
//     toast.success("Produk dipilih", {
//       description: (
//         <div className="text-xs space-y-0.5 mt-1">
//           <div><span className="font-semibold">Customer:</span> {customerId}</div>
//           <div><span className="font-semibold">Product:</span> {product.product_name}</div>
//           {product.family   && <div><span className="font-semibold">Family:</span>   {product.family}</div>}
//           {product.asp      !== undefined && (
//             <div><span className="font-semibold">ASP:</span> {new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(product.asp)}</div>
//           )}
//           {product.gmPct    !== undefined && (
//             <div><span className="font-semibold">GM%:</span> {product.gmPct.toFixed(2)}%</div>
//           )}
//         </div>
//       ),
//     })
//   }

//   return (
//     <Popover open={open} onOpenChange={handleOpenChange}>
//       <PopoverTrigger asChild>
//         {/* Pill yang sudah ada — bungkus dengan button invisible */}
//         <button
//           className={`text-[11px] font-bold text-center border rounded-md px-1.5 py-0.5 flex-1 min-w-0 truncate cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all ${pillClassName}`}
//           title="Klik untuk pilih produk lain"
//         >
//           {selected ? selected.product_name : defaultLabel}
//         </button>
//       </PopoverTrigger>

//       <PopoverContent className="w-64 p-0" align="start" side="bottom">
//         <Command>
//           <CommandInput placeholder="Cari produk..." />
//           <CommandList>
//             {loading && (
//               <div className="flex items-center justify-center py-4 gap-2 text-xs text-muted-foreground">
//                 <Loader2 className="w-4 h-4 animate-spin" /> Memuat produk…
//               </div>
//             )}
//             {!loading && <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>}
//             {!loading && products.length > 0 && (
//               <CommandGroup>
//                 {products.map(p => (
//                   <CommandItem
//                     key={p.id}
//                     value={p.product_name}
//                     onSelect={() => handleSelect(p)}
//                     className="text-xs"
//                   >
//                     {p.product_name}
//                   </CommandItem>
//                 ))}
//               </CommandGroup>
//             )}
//           </CommandList>
//         </Command>
//       </PopoverContent>
//     </Popover>
//   )
// }

// // Tambahan: Type untuk Sorting
// type SortKey = "GM" | "CUSTOMER" | "SELLING_PRICE" | null;
// type SortOrder = "asc" | "desc";

// export function CustomerStrategyCarousel({ data = [] }: Props) {
//   // Defensive Check: Ensure data is always an array
//   const safeData = Array.isArray(data) ? data : [];
  
//   // ── STATE UNTUK SORTING & SEARCH ─────────────────────────────────────────────────────
//   const [sortKey, setSortKey] = React.useState<SortKey>(null);
//   const [sortOrder, setSortOrder] = React.useState<SortOrder>("desc");
//   const [searchQuery, setSearchQuery] = React.useState("");

//   // ── FUNGSI HANDLER SORTING ──────────────────────────────────────────────────
//   const handleSort = (key: SortKey) => {
//     if (sortKey === key) {
//       setSortOrder(sortOrder === "asc" ? "desc" : "asc");
//     } else {
//       setSortKey(key);
//       setSortOrder("desc");
//     }
//   };

//   // ── LOGIC MENGURUTKAN & MEMFILTER DATA ──────────────────────────────────────
//   const processedData = React.useMemo(() => {
//     // 1. Filter Data berdasarkan Search Query dulu
//     let filteredData = safeData;
//     if (searchQuery.trim() !== "") {
//       const lowerQuery = searchQuery.toLowerCase();
//       filteredData = safeData.filter(item => 
//         item.customerId.toLowerCase().includes(lowerQuery)
//       );
//     }

//     // 2. Sort Data yang sudah difilter
//     if (!sortKey) return filteredData;

//     return [...filteredData].sort((a, b) => {
//       let valA: number | string = 0;
//       let valB: number | string = 0;

//       if (sortKey === "GM") {
//         valA = a.projectedPerformance?.projectedGmPct || 0;
//         valB = b.projectedPerformance?.projectedGmPct || 0;
//       } else if (sortKey === "CUSTOMER") {
//         valA = a.customerId.toLowerCase();
//         valB = b.customerId.toLowerCase();
//       } else if (sortKey === "SELLING_PRICE") {
//         valA = a.projectedPerformance?.projectedQty > 0 
//           ? a.projectedPerformance.projectedSales / a.projectedPerformance.projectedQty 
//           : 0;
//         valB = b.projectedPerformance?.projectedQty > 0 
//           ? b.projectedPerformance.projectedSales / b.projectedPerformance.projectedQty 
//           : 0;
//       }

//       if (valA < valB) return sortOrder === "asc" ? -1 : 1;
//       if (valA > valB) return sortOrder === "asc" ? 1 : -1;
//       return 0;
//     });
//   }, [safeData, sortKey, sortOrder, searchQuery]);

//   // Helper function untuk merender icon tombol
//   const renderSortIcon = (key: SortKey) => {
//     // Kalau kolom tidak sedang aktif, pakai panah atas-bawah netral
//     if (sortKey !== key) return <ArrowUpDown className="h-3.5 w-3.5" />;
    
//     // Icon khusus untuk Abjad (Customer)
//     if (key === "CUSTOMER") {
//       return sortOrder === "asc" 
//         ? <ArrowDownAZ className="h-3.5 w-3.5" /> 
//         : <ArrowDownZA className="h-3.5 w-3.5" />;
//     } 
    
//     // Icon khusus untuk Angka (GM & Selling Price)
//     return sortOrder === "asc" 
//       ? <ArrowUpWideNarrow className="h-3.5 w-3.5" /> 
//       : <ArrowDownWideNarrow className="h-3.5 w-3.5" />;
//   };

//   const formatCurrency = (value: number) => 
//     new Intl.NumberFormat("id-ID", {
//       style: "currency",
//       currency: "IDR",
//       maximumFractionDigits: 0
//     }).format(value)

//   // Calculate Global Weighted Averages for Summary
//   let totalSales = 0;
//   let totalCurrentGmValue = 0;
//   let totalProjectedGmValue = 0;
//   let totalQty = 0;
//   let totalProjectedQty = 0;
//   let totalProjectedSales = 0;

//   safeData.forEach(item => {
//     const sales = item.currentPerformance.nettSales;
//     totalSales += sales;
//     totalCurrentGmValue += sales * (item.currentPerformance.currentGmPct / 100);
//     totalProjectedGmValue += sales * (item.projectedPerformance.projectedGmPct / 100);
//     totalQty += item.currentPerformance.currentQty || 0;
//     totalProjectedQty += item.projectedPerformance.projectedQty || 0;
//     totalProjectedSales += item.projectedPerformance.projectedSales || 0;
//   });

//   const avgCurrentGmPct = totalSales > 0 ? (totalCurrentGmValue / totalSales) * 100 : 0;
//   const avgProjectedGmPct = totalSales > 0 ? (totalProjectedGmValue / totalSales) * 100 : 0;
//   const projectedSales = totalProjectedSales;
//   const projectedGmValue = totalProjectedGmValue;
//   const totalCurrentGMValue = totalCurrentGmValue;
  
//   // Confirm formula global
//   const avgSellingPrice = totalQty > 0 ? totalSales / totalQty : 0;
//   const projectedAvgSellingPrice = totalProjectedQty > 0 ? totalProjectedSales / totalProjectedQty : 0;

//   // Color Grading 
//   const getGmColor = (gm: number) => {
//     if (gm < -9) return 'text-destructive';
//     if (gm < 0) return 'text-orange-500';
//     if (gm <= 9) return 'text-blue-600';
//     return 'text-emerald-600'; // Gunakan biru untuk >9 agar beda dengan emerald
//   };

//   return (
//     <div className="space-y-6">
      
//       {/* 1. SUMMARY SECTION */}
//       {safeData.length > 0 && (() => {
//         // Helper untuk Dark Mode UI yang elegan
//         const getCardTheme = (gm: number) => {
//           if (gm < -9) return { card: "bg-red-500/10 border-red-500/20", label: "text-red-400", value: "text-red-500", icon: "text-red-500" };
//           if (gm < 0) return { card: "bg-orange-500/10 border-orange-500/20", label: "text-orange-400", value: "text-orange-500", icon: "text-orange-500" };
//           if (gm <= 9) return { card: "bg-blue-500/10 border-blue-500/20", label: "text-blue-400", value: "text-blue-500", icon: "text-blue-500" };
//           return { card: "bg-emerald-500/10 border-emerald-500/20", label: "text-emerald-400", value: "text-emerald-500", icon: "text-emerald-500" };
//         };

//         const currentTheme = getCardTheme(avgCurrentGmPct);
//         const projectedTheme = getCardTheme(avgProjectedGmPct);

//         return (
//           <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-b pb-6 mb-6 border-primary/50">
//             <h1 className="text-2xl font-bold text-primary/90 col-span-full">Executive Summary</h1>

//             {/* Current Nett Sales - full width di mobile */}
//             <Card size="sm" className="col-span-2 md:col-span-1 bg-primary/90 border-primary/20 shadow-sm">
//               <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
//                 <div className="absolute -right-4 -top-4 opacity-10">
//                   <CircleDollarSign size={90} className="text-white text-fluid-sm"/>
//                 </div>
//                 <span className="text-fluid-xs text-slate-200 font-semibold uppercase tracking-wider mb-1">Current Nett Sales</span>
//                 <span className="text-fluid-lg font-bold text-slate-100">{formatCurrency(totalSales)}</span>
//               </CardContent>
//             </Card>

//             {/* Current Global GM% */}
//             <Card size="sm" className={`shadow-sm ${currentTheme.card}`}>
//               <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
//                 <div className="absolute -right-4 -top-4 opacity-10">
//                   <MountainSnow className={`w-20 h-20 ${currentTheme.icon}`} />
//                 </div>
//                 <span className={`text-fluid-xs font-semibold uppercase tracking-wider ${currentTheme.label}`}>
//                   Current Global GM%
//                 </span>
//                 <span className={`text-fluid-lg font-bold z-10 ${currentTheme.value}`}>
//                   {avgCurrentGmPct.toFixed(2)}%
//                 </span>
//               </CardContent>
//             </Card>

//             {/* Current Global GM Value */}
//             <Card size="sm" className={`shadow-sm ${currentTheme.card}`}>
//               <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
//                 <div className="absolute -right-4 -top-4 opacity-10">
//                   <Wallet2 className={`w-20 h-20 ${currentTheme.icon}`} />
//                 </div>
//                 <span className={`text-fluid-xs font-semibold uppercase tracking-wider mb-1 ${currentTheme.label}`}>
//                   Current Global GM Value
//                 </span>
//                 <span className={`text-fluid-lg font-bold z-10 ${currentTheme.value}`}>
//                   {formatCurrency(totalCurrentGMValue)}
//                 </span>
//               </CardContent>
//             </Card>

//             {/* Current Avg Selling Price */}
//             <Card size="sm" className={`col-span-2 md:col-span-1 shadow-sm ${currentTheme.card}`}>
//               <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
//                 <div className="absolute -right-4 -top-4 opacity-10">
//                   <Wallet2 className={`w-20 h-20 ${currentTheme.icon}`} />
//                 </div>
//                 <span className={`text-fluid-xs font-semibold uppercase tracking-wider mb-1 ${currentTheme.label}`}>
//                   Current Average Selling Price
//                 </span>
//                 <span className={`text-fluid-lg font-bold z-10 ${currentTheme.value}`}>
//                   {formatCurrency(avgSellingPrice)}
//                 </span>
//               </CardContent>
//             </Card>

//             {/* Projected Nett Sales - full width di mobile */}
//             <Card size="sm" className={`col-span-2 md:col-span-1 shadow-sm ${projectedTheme.card}`}>
//               <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
//                 <div className="absolute -right-4 -top-4 opacity-10">
//                   <CircleDollarSign size={90} className={projectedTheme.icon}/>
//                 </div>
//                 <span className={`text-fluid-xs font-semibold uppercase tracking-wider mb-1 ${projectedTheme.label}`}>
//                   Projected Nett Sales
//                 </span>
//                 <span className={`text-fluid-lg font-bold z-10 ${projectedTheme.value}`}>
//                   {formatCurrency(projectedSales)}
//                 </span>
//               </CardContent>
//             </Card>

//             {/* Projected Global GM% */}
//             <Card size="sm" className={`shadow-sm ${projectedTheme.card}`}>
//               <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
//                 <div className="absolute -right-4 -top-4 opacity-10">
//                   <Sparkles className={`w-20 h-20 ${projectedTheme.icon}`} />
//                 </div>
//                 <span className={`text-fluid-xs font-semibold uppercase tracking-wider z-10 ${projectedTheme.label}`}>
//                   Projected Global GM%
//                 </span>
//                 <span className={`text-fluid-lg font-bold z-10 ${projectedTheme.value}`}>
//                   {avgProjectedGmPct.toFixed(2)}%
//                 </span>
//               </CardContent>
//             </Card>

//             {/* Projected Global GM Value */}
//             <Card size="sm" className={`shadow-sm ${projectedTheme.card}`}>
//               <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
//                 <div className="absolute -right-4 -top-4 opacity-10">
//                   <Wallet2 className={`w-20 h-20 ${projectedTheme.icon}`} />
//                 </div>
//                 <span className={`text-fluid-xs font-semibold uppercase tracking-wider z-10 ${projectedTheme.label}`}>
//                   Projected Global GM Value
//                 </span>
//                 <span className={`text-fluid-lg font-bold z-10 ${projectedTheme.value}`}>
//                   {formatCurrency(projectedGmValue)}
//                 </span>
//               </CardContent>
//             </Card>

//             {/* Projected Avg Selling Price - full width di mobile */}
//             <Card size="sm" className={`col-span-2 md:col-span-1 shadow-sm ${projectedTheme.card}`}>
//               <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
//                 <div className="absolute -right-4 -top-4 opacity-10">
//                   <Wallet2 className={`w-20 h-20 ${projectedTheme.icon}`} />
//                 </div>
//                 <span className={`text-fluid-xs font-semibold uppercase tracking-wider z-10 ${projectedTheme.label}`}>
//                   Projected Average Selling Price
//                 </span>
//                 <span className={`text-fluid-lg font-bold z-10 ${projectedTheme.value}`}>
//                   {formatCurrency(projectedAvgSellingPrice)}
//                 </span>
//               </CardContent>
//             </Card>
//           </div>
//         );
//       })()}
//       {/* BUTTON GROUP SORTING UPDATE */}
//       {/* SEARCH & BUTTON GROUP SORTING UPDATE */}
//       <div className="col-span-full flex flex-col md:flex-row justify-between items-center gap-4 mt-4">
//         {/* Kolom Search */}
//         <div className="relative w-full md:w-80">
//           <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
//           <Input
//             type="text"
//             placeholder="Search Customer..."
//             className="pl-9 bg-background border-primary/20 focus-visible:ring-primary"
//             value={searchQuery}
//             onChange={(e) => setSearchQuery(e.target.value)}
//           />
//         </div>

//         {/* Kolom Sorting */}
//         <>
//           {/* Mobile: Dropdown */}
//           <div className="md:hidden w-full">
//             <DropdownMenu>
//               <DropdownMenuTrigger asChild>
//                 <Button variant="outline" size="sm" className="w-full text-fluid-xs gap-2 text-primary">
//                   <ArrowUpDown className="w-3 h-3" />
//                   {sortKey === "GM" ? "Sort By GM"
//                     : sortKey === "CUSTOMER" ? "Sort By Customer"
//                     : sortKey === "SELLING_PRICE" ? "Sort By Selling Price"
//                     : "Sort By"}
//                   <ChevronDown className="w-3 h-3 ml-auto" />
//                 </Button>
//               </DropdownMenuTrigger>
//               <DropdownMenuContent className="w-full">
//                 <DropdownMenuItem onClick={() => handleSort("GM")} className={`gap-2 ${sortKey === "GM" ? "text-primary font-semibold" : ""}`}>
//                   {renderSortIcon("GM")} Sort By Projected GM
//                 </DropdownMenuItem>
//                 <DropdownMenuItem onClick={() => handleSort("CUSTOMER")} className={`gap-2 ${sortKey === "CUSTOMER" ? "text-primary font-semibold" : ""}`}>
//                   {renderSortIcon("CUSTOMER")} Sort By Customer
//                 </DropdownMenuItem>
//                 <DropdownMenuItem onClick={() => handleSort("SELLING_PRICE")} className={`gap-2 ${sortKey === "SELLING_PRICE" ? "text-primary font-semibold" : ""}`}>
//                   {renderSortIcon("SELLING_PRICE")} Sort By Projected Selling Price
//                 </DropdownMenuItem>
//               </DropdownMenuContent>
//             </DropdownMenu>
//           </div>

//           {/* Desktop: ButtonGroup asli */}
//           <ButtonGroup className="hidden md:flex w-auto justify-end">
//             <Button
//               variant="outline"
//               size="sm"
//               onClick={() => handleSort("GM")}
//               className={`text-fluid-xs gap-2 ${sortKey === "GM" ? "bg-primary text-primary-foreground hover:bg-primary/80" : "bg-transparent text-primary hover:bg-primary/10"}`}
//             >
//               {renderSortIcon("GM")} Projected GM
//             </Button>
//             <Button
//               variant="outline"
//               size="sm"
//               onClick={() => handleSort("CUSTOMER")}
//               className={`text-fluid-xs gap-2 ${sortKey === "CUSTOMER" ? "bg-primary text-primary-foreground hover:bg-primary/80" : "bg-transparent text-primary hover:bg-primary/10"}`}
//             >
//               {renderSortIcon("CUSTOMER")} Customer
//             </Button>
//             <Button
//               variant="outline"
//               size="sm"
//               onClick={() => handleSort("SELLING_PRICE")}
//               className={`text-fluid-xs gap-2 ${sortKey === "SELLING_PRICE" ? "bg-primary text-primary-foreground hover:bg-primary/80" : "bg-transparent text-primary hover:bg-primary/10"}`}
//             >
//               {renderSortIcon("SELLING_PRICE")} Projected Selling Price
//             </Button>
//           </ButtonGroup>
//         </>
//       </div>

//       <Carousel opts={{ align: "start", watchResize: true, watchSlides: false }} className="w-full">
//   <CarouselContent>
//     {processedData.map((customer, index) => {
//       const isNeedsOpt = customer.currentPerformance.status === "Needs Optimization"
//       const improvement = customer.projectedPerformance?.improvement || 0
//       const currentGmGlobal = customer.currentPerformance.currentGmPct;
//       const projectedGmGlobal = customer.projectedPerformance.projectedGmPct;

//       return (
//         <CarouselItem key={`${customer.customerId}-${index}`} className="min-w-0 shrink-0 basis-full sm:basis-1/1 md:basis-1/2 2xl:basis-1/3 xl:basis-1/2 pl-4">
//           <Card className="h-full flex flex-col shadow-sm border border-card-border bg-primary/3 [content-visibility:auto]">
//             <CardHeader className="pb-3 border-b">
//               <div className="flex justify-between items-start gap-2">
//                 <CardTitle className="text-lg font-bold">{customer.customerId}</CardTitle>
//                 <Badge variant={isNeedsOpt ? "destructive" : "default"} className="text-[10px] px-2 shrink-0 whitespace-nowrap">
//                   {isNeedsOpt ? <AlertCircle className="w-3 h-3 mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
//                   {customer.currentPerformance.status}
//                 </Badge>
//               </div>

//               {/* Summary GM Box */}
//               <div className="flex items-start gap-2 mt-3 p-2 bg-primary/15 rounded-md border shadow-sm">
//                 <div className="flex flex-col min-w-0 flex-1">
//                   <span className="text-[8px] uppercase tracking-wider font-semibold">Current</span>
//                   <span className="text-xs font-bold">
//                     GM: <span className={getGmColor(currentGmGlobal)}>{currentGmGlobal.toFixed(2)}%</span>
//                   </span>
//                   <span className="text-[10px] font-medium">
//                     Nett. Sales: <span className={getGmColor(currentGmGlobal)}>{formatCurrency(customer.currentPerformance.nettSales)}</span>
//                   </span>
//                   <span className="text-[10px] font-medium">
//                     Qty: <span className={getGmColor(currentGmGlobal)}>{customer.currentPerformance.currentQty.toFixed(2)}</span>
//                   </span>
//                 </div>

//                 <ArrowRight className="w-3 h-3 shrink-0 mt-3" />

//                 <div className="flex flex-col min-w-0 flex-1">
//                   <span className="text-[8px] uppercase tracking-wider font-semibold">Projected</span>
//                   <span className={`text-xs font-bold ${getGmColor(projectedGmGlobal)}`}>{projectedGmGlobal.toFixed(2)}%</span>
//                   <span className={`text-[10px] font-bold truncate ${getGmColor(projectedGmGlobal)}`}>
//                     {formatCurrency(customer.projectedPerformance.projectedSales)}
//                   </span>
//                   <span className={`text-[10px] font-bold ${getGmColor(projectedGmGlobal)}`}>
//                     {customer.projectedPerformance.projectedQty}
//                   </span>
//                 </div>

//                 {improvement > 0 && (
//                   <div className="flex flex-col gap-0.5 items-end shrink-0">
//                     <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] font-bold px-1 py-0 whitespace-nowrap">
//                       +{improvement.toFixed(2)}%
//                     </Badge>
//                     <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] font-bold px-1 py-0 whitespace-nowrap">
//                       +{formatCurrency(customer.projectedPerformance.projectedSales - customer.currentPerformance.nettSales)}
//                     </Badge>
//                   </div>
//                 )}
//               </div>
//             </CardHeader>

//             <CardContent className="flex-1 flex flex-col gap-4 mt-4">
//               <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary/90 uppercase tracking-tight">
//                 <TrendingUp className="w-3.5 h-3.5" /> Recommendation
//               </div>

//               <ScrollArea className="h-[420px] pr-4">
//                 <div className="space-y-5">
//                   {(customer.productMixStrategy?.shiftCards?.length > 0 ||
//                     customer.nextMonthPlan?.retainedProducts?.length > 0 ||
//                     customer.nextMonthPlan?.removedProducts?.length > 0) && (
//                     <div className="space-y-2">
//                       {(() => {
//                         const shiftCards = customer.productMixStrategy?.shiftCards || [];
//                         const retainedProducts = customer.nextMonthPlan?.retainedProducts || [];
//                         const removedProducts = customer.nextMonthPlan?.removedProducts || [];
//                         const renderItems = [];

//                         shiftCards.forEach(card => {
//                           renderItems.push({
//                             type: 'shifted',
//                             badgeLabel: '🔄 Product Switch',
//                             badgeClass: 'bg-primary text-primary-foreground border-primary shadow-sm',
//                             source: card.fromProduct,
//                             target: card.toProduct,
//                             uplift: card.shift.salesUplift,
//                             displayQty: card.shift.shiftedQty,
//                             displaySales: card.shift.salesFromShift,
//                             targetSpecDisplay: card.toProduct.spec,
//                             targetSpecClass: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
//                           });
//                         });

//                         retainedProducts.forEach(prod => {
//                           renderItems.push({
//                             type: 'retained',
//                             badgeLabel: '✅ No Change',
//                             badgeClass: 'bg-secondary-foreground text-secondary border-border shadow-sm',
//                             source: {
//                               spec: prod.spec,
//                               current: {
//                                 gmPct: prod.lastMonthGmPct || prod.projGmPct,
//                                 sales: prod.lastMonthSales || prod.projSales,
//                                 qty: prod.lastMonthQty || prod.projQty,
//                                 asp: prod.lastMonthAsp || prod.projAsp
//                               }
//                             },
//                             target: {
//                               projected: {
//                                 gmPct: prod.projGmPct,
//                                 sales: prod.projSales,
//                                 qty: prod.projQty,
//                                 asp: prod.projAsp
//                               }
//                             },
//                             uplift: 0,
//                             displayQty: prod.projQty,
//                             displaySales: prod.projSales,
//                             targetSpecDisplay: 'No Change',
//                             targetSpecClass: 'text-slate-200 bg-slate-800 border-slate-700'
//                           });
//                         });

//                         removedProducts.forEach(prod => {
//                           renderItems.push({
//                             type: 'removed',
//                             badgeLabel: '❌ Removed',
//                             badgeClass: 'bg-destructive/10 text-destructive border-destructive/20 shadow-sm',
//                             source: {
//                               spec: prod.spec,
//                               current: { gmPct: prod.lastMonthGmPct, sales: prod.lastMonthSales, qty: prod.lastMonthQty, asp: prod.lastMonthAsp }
//                             },
//                             target: {
//                               projected: { gmPct: prod.projGmPct, sales: prod.projSales, qty: prod.projQty, asp: prod.projAsp }
//                             },
//                             uplift: 0,
//                             displayQty: prod.projQty,
//                             displaySales: prod.projSales,
//                             targetSpecDisplay: 'Removed',
//                             targetSpecClass: 'text-destructive bg-destructive/10 border-destructive/20'
//                           });
//                         });

//                         return renderItems
//                           .sort((a, b) => {
//                             const order = { 'shifted': 1, 'retained': 2, 'removed': 3 };
//                             return order[a.type] - order[b.type];
//                           })
//                           .map((item, idx) => {
//                             const isShifted = item.type === 'shifted';
//                             const isRemoved = item.type === 'removed';
//                             const currentGm    = item.source.current.gmPct;
//                             const projectedGm  = item.target.projected.gmPct;
//                             const currentSales = item.source.current.sales;
//                             const currentQty   = item.source.current.qty;

//                             return (
//                             <div key={idx} className={`flex flex-col p-2 border rounded-md relative mt-3 hover:shadow-md transition-colors ${
//                               isRemoved ? 'bg-destructive/5 border-destructive/20' : 'bg-primary/9 border-border'
//                             }`}>

//                               <Badge
//                                 variant="secondary"
//                                 className={`text-[9px] px-1.5 py-0 whitespace-nowrap mb-2 w-fit border absolute -top-2.5 left-2 ${item.badgeClass}`}
//                               >
//                                 {item.badgeLabel}
//                               </Badge>

//                               {/* Product pills */}
//                               <div className="flex items-center justify-between gap-1.5 mb-2 mt-1">
//                                 <span className={`text-[11px] font-bold text-center rounded-md px-1.5 py-0.5 flex-1 min-w-0 truncate ${
//                                   currentGm < 9
//                                     ? 'text-destructive bg-destructive/10 border border-destructive/20'
//                                     : 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20'
//                                 }`}>
//                                   {item.source.spec}
//                                 </span>
//                                 <ArrowRight className={`w-3 h-3 shrink-0 ${!isShifted || isRemoved ? 'text-slate-600/30' : 'text-slate-400'}`} />
//                                 {/* <span className={`text-[11px] font-bold text-center border rounded-md px-1.5 py-0.5 flex-1 min-w-0 truncate ${item.targetSpecClass}`}>
//                                   {item.targetSpecDisplay}
//                                 </span> */}
//                                 {item.type === "removed" ? (
//                                   <span className={`text-[11px] font-bold text-center border rounded-md px-1.5 py-0.5 flex-1 min-w-0 truncate ${item.targetSpecClass}`}>
//                                     {item.targetSpecDisplay}
//                                   </span>
//                                 ) : (
//                                   <ProjectedProductPopover
//                                     defaultLabel={item.targetSpecDisplay}
//                                     pillClassName={item.targetSpecClass}
//                                     customerId={customer.customerId}
//                                   />
//                                 )}
//                               </div>

//                               {/* Current vs Projected grid */}
//                               <div className="grid grid-cols-2 gap-2 relative">
//                                 <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-700/30" />

//                                 {/* Kolom kiri */}
//                                 <div className="flex flex-col gap-0.5 pr-1.5">
//                                   <span className="text-[8px] uppercase tracking-wider font-semibold">Current</span>
//                                   <span className="text-[11px] font-bold">
//                                     GM: <span className={getGmColor(currentGm)}>{currentGm.toFixed(2)}%</span>
//                                   </span>
//                                   <span className="text-[10px]">Sales: <span className={getGmColor(currentGm)}>{formatCurrency(currentSales)}</span></span>
//                                   <span className="text-[10px]">Qty: <span className={getGmColor(currentGm)}>{Number(currentQty).toFixed(2)}</span></span>
//                                   <span className="text-[10px]">Price: <span className={getGmColor(currentGm)}>{formatCurrency(item.source.current.asp)}</span></span>
//                                 </div>

//                                 {/* Kolom kanan */}
//                                 <div className="flex flex-col gap-0.5 pl-1.5">
//                                   <span className="text-[8px] uppercase tracking-wider font-semibold">Projected</span>

//                                   <div className="flex flex-wrap items-center gap-1">
//                                     <span className={`text-[11px] font-bold ${isRemoved ? 'text-slate-500' : getGmColor(projectedGm)}`}>
//                                       {projectedGm.toFixed(2)}%
//                                     </span>
//                                     {isShifted && (
//                                       <Badge variant="outline" className={`px-1 py-0 text-[8px] font-bold whitespace-nowrap ${getGmColor(projectedGm)} bg-emerald-500/10 border-emerald-500/20`}>
//                                         {(projectedGm - currentGm) > 0 ? '+' : ''}{(projectedGm - currentGm).toFixed(2)}%
//                                       </Badge>
//                                     )}
//                                   </div>

//                                   <div className="flex flex-wrap items-center gap-1">
//                                     <span className={`text-[10px] ${isRemoved ? 'text-slate-500' : getGmColor(projectedGm)}`}>
//                                       {formatCurrency(item.displaySales)}
//                                     </span>
//                                     {isShifted && (
//                                       <Badge variant="outline" className={`px-1 py-0 text-[8px] font-bold whitespace-nowrap ${getGmColor(projectedGm)} bg-emerald-500/10 border-emerald-500/20`}>
//                                         {item.uplift < 0 ? '-' : '+'}{formatCurrency(Math.abs(item.uplift))}
//                                       </Badge>
//                                     )}
//                                   </div>

//                                   <span className={`text-[10px] ${isRemoved ? 'text-slate-500' : getGmColor(projectedGm)}`}>
//                                     {Number(item.displayQty).toFixed(2)}
//                                   </span>
//                                   <span className={`text-[10px] ${isRemoved ? 'text-slate-500' : getGmColor(projectedGm)}`}>
//                                     {formatCurrency(item.target.projected.asp)}
//                                   </span>
//                                 </div>
//                               </div>
//                             </div>
//                             );
//                           });
//                       })()}
//                     </div>
//                   )}
//                 </div>
//               </ScrollArea>

//               {customer.productMixStrategy.aiReasoning && (
//                 <div className="bg-primary/5 p-3 rounded-md border border-primary/20 flex items-start gap-2 max-w-[96%]">
//                   <Lightbulb className="w-4 h-4 text-primary shrink-0 mt-0.5" />
//                   <ScrollArea className="h-[420px] pr-4">
//                     <div className="text-xs leading-relaxed font-medium space-y-1.5 w-full">
//                       {customer.productMixStrategy.aiReasoning
//                         .split('\n')
//                         .flatMap(line => line.split(/(?=\d+\.\s)/))
//                         .map(line => line.replace(/\*\*/g, '').replace(/#/g, '').trim())
//                         .filter(line => line.length > 0)
//                         .map((line, idx) => {
//                           const isNumbered = /^\d+\./.test(line);
//                           return (
//                             <div key={idx} className={`italic ${isNumbered ? 'flex gap-1.5 ml-2' : 'font-semibold opacity-80 mb-2'}`}>
//                               {isNumbered ? (
//                                 <>
//                                   <span className="font-bold text-primary">{line.match(/^\d+\./)?.[0]}</span>
//                                   <span className="opacity-90">{line.replace(/^\d+\.\s/, '').replace(/"/g, '')}</span>
//                                 </>
//                               ) : (
//                                 <span>{line}</span>
//                               )}
//                             </div>
//                           );
//                         })}
//                     </div>
//                   </ScrollArea>
//                 </div>
//               )}
//             </CardContent>
//           </Card>
//         </CarouselItem>
//       )
//     })}
//   </CarouselContent>

//   <CarouselPrevious className="sticky-center left-0 -translate-x-1/2 bg-slate-900 text-slate-300 shadow-md border border-slate-700 hover:bg-slate-800 z-10 w-8 h-8" />
//   <CarouselNext className="sticky-center right-0 translate-x-1/2 bg-slate-900 text-slate-300 shadow-md border border-slate-700 hover:bg-slate-800 z-10 w-8 h-8" />
// </Carousel>
//     </div>
//   )
// }