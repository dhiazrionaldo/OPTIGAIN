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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TrendingDown, TrendingUp, AlertCircle, CheckCircle2, ArrowRight, Lightbulb, Sparkles, MountainSnow, CircleDollarSign } from "lucide-react"

export interface CustomerStrategy {
  customerId: string;
  currentPerformance: {
    nettSales: number;
    currentGmPct: number;
    status: string;
  };
  projectedPerformance: {
    projectedGmPct: number;
    targetGmPct: number;
    improvement: number;
  };
  productMixStrategy: {
    reduceOrRenegotiate: string[];
    upsellExisting: string[];
    intraFamilyShifts: Array<{
      family: string;
      from: string;
      to: string;
      shifted_sales_value: number;
    }>;
    aiReasoning: string;
  };
}

interface Props {
  data: CustomerStrategy[];
}

export function CustomerStrategyCarousel({ data = [] }: Props) {
  // Defensive Check: Ensure data is always an array
  const safeData = Array.isArray(data) ? data : [];
  
  const formatCurrency = (value: number) => 
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(value)

  // Calculate Global Weighted Averages for Summary
  let totalSales = 0;
  let totalCurrentGmValue = 0;
  let totalProjectedGmValue = 0;

  safeData.forEach(item => {
    const sales = item.currentPerformance.nettSales;
    totalSales += sales;
    totalCurrentGmValue += sales * (item.currentPerformance.currentGmPct / 100);
    totalProjectedGmValue += sales * (item.projectedPerformance.projectedGmPct / 100);
  });

  const avgCurrentGmPct = totalSales > 0 ? (totalCurrentGmValue / totalSales) * 100 : 0;
  const avgProjectedGmPct = totalSales > 0 ? (totalProjectedGmValue / totalSales) * 100 : 0;

  //Color Grading 
  const getGmColor = (gm: number) => {
    if (gm < -9) return 'text-red-600';
    if (gm < 0) return 'text-orange-600';
    if (gm <= 9) return 'text-emerald-600';
    return 'text-blue-600'; // Gunakan biru untuk >9 agar beda dengan emerald
  };
  return (
    <div className="space-y-6">
      
      {/* 1. SUMMARY SECTION */}
      {/* 1. SUMMARY SECTION */}
      {safeData.length > 0 && (() => {
        // Helper untuk Dark Mode UI yang elegan
        const getCardTheme = (gm: number) => {
          if (gm < -9) return { 
            card: "bg-red-500/10 border-red-500/20", 
            label: "text-red-400", 
            value: "text-red-500", 
            icon: "text-red-500" 
          };
          if (gm < 0) return { 
            card: "bg-orange-500/10 border-orange-500/20", 
            label: "text-orange-400", 
            value: "text-orange-500", 
            icon: "text-orange-500" 
          };
          if (gm <= 9) return { 
            card: "bg-emerald-500/10 border-emerald-500/20", 
            label: "text-emerald-400", 
            value: "text-emerald-500", 
            icon: "text-emerald-500" 
          };
          return { 
            card: "bg-blue-500/10 border-blue-500/20", 
            label: "text-blue-400", 
            value: "text-blue-500", 
            icon: "text-blue-500" 
          };
        };

        const currentTheme = getCardTheme(avgCurrentGmPct);
        const projectedTheme = getCardTheme(avgProjectedGmPct);

        return (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 border-b pb-6 mb-6 border-primary/50">
            <h1 className="text-2xl font-bold text-primary/90 col-span-full">Executive Summary</h1>
            
            {/* Total Nett Sales (Tetap Netral/Primary) */}
            <Card size="sm" className={`bg-primary-50 border-primary-200 shadow-sm max-h-[66px] `}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10">
                  <CircleDollarSign size={90} />
                </div>
                <span className="text-xs text-primary/90 font-semibold uppercase tracking-wider mb-1">Total Nett Sales</span>
                <span className="text-lg md:text-lg font-bold text-primary/100">{formatCurrency(totalSales)}</span>
              </CardContent>
            </Card>

            {/* Current Global GM% Card (Dinamis) */}
            <Card size="sm" className={`max-h-[66px] shadow-sm ${currentTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10">
                  <MountainSnow className={`w-20 h-20 ${currentTheme.icon}`} />
                </div>
                <span className={`text-xs font-semibold uppercase tracking-wider  ${currentTheme.label}`}>
                  Current Global GM%
                </span>
                <span className={`text-xl md:text-2xl font-bold ${currentTheme.value}`}>
                  {avgCurrentGmPct.toFixed(2)}%
                </span>
              </CardContent>
            </Card>

            {/* Projected Global GM% Card (Dinamis) */}
            <Card size="sm" className={`max-h-[66px] shadow-sm col-span-2 md:col-span-1 ${projectedTheme.card}`}>
              <CardContent className="p-0 flex flex-col justify-center items-center text-center relative">
                <div className="absolute -right-4 -top-4 opacity-10">
                  <Sparkles className={`w-20 h-20 ${projectedTheme.icon}`} />
                </div>
                <span className={`text-xs font-semibold uppercase tracking-wider flex items-center z-10 ${projectedTheme.label}`}>
                  Projected Global GM% <Sparkles className="w-3 h-3 ml-1" />
                </span>
                <span className={`text-lg md:text-2xl font-bold z-10 ${projectedTheme.value}`}>
                  {avgProjectedGmPct.toFixed(2)}%
                </span>
              </CardContent>
            </Card>
          </div>
        );
      })()}
      {/* {safeData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 border-b pb-6 mb-6 border-primary/50">
          <h1 className="text-2xl font-bold text-primary/90 col-span-full">Executive Summary</h1>
          <Card size="sm" className="bg-primary-50 border-primary-200 shadow-sm max-h-[66px]">
            <CardContent className="p-0 flex flex-col justify-center items-center text-center">
              <span className="text-xs text-primary/90 font-semibold uppercase tracking-wider mb-1">Total Nett Sales</span>
              <span className="text-lg md:text-lg font-bold text-primary/100">{formatCurrency(totalSales)}</span>
            </CardContent>
          </Card>
          <Card size="sm" className={`max-h-[66px] shadow-sm ${avgCurrentGmPct < 0 ? 'bg-destructive/15 border-destructive/20' : 'bg-primary/5 border-primary/20'}`}>
            <CardContent className="p-0 flex flex-col justify-center items-center text-center">
              
              
              <span className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
                avgCurrentGmPct < 0 ? 'text-red-600' : 'text-primary/90'
              }`}>
                Current Global GM%
              </span>
              
              
              <span className={`text-xl md:text-2xl font-bold ${
                avgCurrentGmPct < 0 ? 'text-red-700' : 'text-primary'
              }`}>
                {avgCurrentGmPct.toFixed(2)}%
              </span>
              
            </CardContent>
          </Card>
          <Card size="sm" className="max-h-[66px] bg-emerald-50 border-emerald-200 shadow-sm col-span-2 md:col-span-1">
            <CardContent className="p-0 flex flex-col justify-center items-center text-center relative overflow-hidden">
              <div className="absolute -right-4 -top-4 opacity-10"><Sparkles className="w-20 h-20 text-emerald-600" /></div>
              <span className="text-xs text-emerald-700 font-semibold uppercase tracking-wider flex items-center z-10">
                Projected Global GM% <Sparkles className="w-3 h-3 ml-1" />
              </span>
              <span className="text-lg md:text-2xl font-bold text-emerald-800 z-10">{avgProjectedGmPct.toFixed(2)}%</span>
            </CardContent>
          </Card>
        </div>
      )} */}
      <Carousel opts={{ align: "start", watchResize: true, watchSlides: false }} className="w-full">
        <CarouselContent>
          {safeData.map((customer, index) => {
            const isNeedsOpt = customer.currentPerformance.status === "Needs Optimization"
            const improvement = customer.projectedPerformance?.improvement || 0
            const grandTotal = customer.productMixStrategy.productDetails.reduce((acc, detail) => {
              // Gunakan Number() untuk memastikan yang ditambah adalah angka, bukan teks
              return acc + Number(detail.projected?.qty || 0);
            }, 0);
            const currentGmGlobal = customer.currentPerformance.currentGmPct;
            const projectedGmGlobal = customer.projectedPerformance.projectedGmPct;

            return (
              <CarouselItem key={`${customer.customerId}-${index}`} className="min-w-0 shrink-0 basis-full md:basis-1/2 lg:basis-1/3 pl-4">
                <Card className="h-full flex flex-col shadow-sm border-primary/10 [content-visibility:auto]">
                  <CardHeader className="pb-3 border-b ">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg font-bold text-slate-300">Customer {customer.customerId}</CardTitle>
                      </div>
                      <Badge variant={isNeedsOpt ? "destructive" : "default"} className="text-[10px] px-2 whitespace-nowrap">
                        {isNeedsOpt ? <AlertCircle className="w-3 h-3 mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                        {customer.currentPerformance.status}
                      </Badge>
                    </div>
                    
                    {/* GM% Before & After (Global Customer) */}
                    <div className="flex items-center gap-3 mt-4 p-2.5 bg-primary/5 rounded-md border shadow-sm">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Current</span>
                        <span className="text-sm font-bold text-slate-400">
                          GM: <span className={getGmColor(currentGmGlobal)}>
                            {currentGmGlobal.toFixed(2)}%
                          </span>
                        </span>
                        <span className="text-xs font-medium text-slate-400">
                          Sales: <span className={getGmColor(currentGmGlobal)}>
                            {formatCurrency(customer.currentPerformance.nettSales)}
                          </span>
                        </span>
                        <span className="text-xs font-medium text-slate-400">
                          Qty: <span className={getGmColor(currentGmGlobal)}>
                            {customer.currentPerformance.currentQty}
                          </span>
                        </span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-300" />
                      <div className="flex flex-col">
                        <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">Projected</span>
                        <span className={`text-sm font-bold ${getGmColor(projectedGmGlobal)}`}>
                          {projectedGmGlobal.toFixed(2)}%
                        </span>
                        <span className={`text-xs font-bold  ${getGmColor(projectedGmGlobal)}`}>
                          {formatCurrency(customer.projectedPerformance.projectedSales)}
                        </span>
                        <span className={`text-xs font-bold  ${getGmColor(projectedGmGlobal)}`}>
                          {customer.projectedPerformance.projectedQty}
                        </span>
                      </div>
                      <div className="flex flex-col justify-end items-end ml-auto">
                      {improvement > 0 && (
                        <Badge variant="outline" className="ml-auto bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-bold">
                          +{improvement.toFixed(2)}%
                        </Badge>
                      )}
                      {improvement > 0 && (
                        <Badge variant="outline" className="ml-auto bg-emerald-50 mt-1 text-emerald-700 border-emerald-200 text-[10px] font-bold">
                          Rp. +{formatCurrency(customer.projectedPerformance.projectedSales - customer.currentPerformance.nettSales)}
                        </Badge>
                      )}
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="flex-1 flex flex-col gap-4 mt-4">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary/90 uppercase tracking-tight">
                      <TrendingUp className="w-3.5 h-3.5" /> Recommendation
                    </div>
                    <ScrollArea className="h-[420px] pr-4">
                      <div className="space-y-5">
                        {customer.productMixStrategy?.productDetails?.length > 0 && (
                          <div className="space-y-2">

                            {/* KITA LOOPING DARI productDetails (Buku Besar), BUKAN intraFamilyShifts 
                              1. Pisahkan produk berdasarkan type
                            */}
                            {(() => {
                              const details = customer.productMixStrategy.productDetails;
                              const sourceProducts = details.filter(p => p.type === 'source');
                              const targetProducts = details.filter(p => p.type === 'target');
                              const originalProducts = details.filter(p => p.type === 'original');

                              // Buat array untuk dirender
                              const renderItems = [];

                              // 2. Gabungkan Source dan Target yang satu family (Untuk kartu "Shifted")
                              sourceProducts.forEach(sourceProd => {
                                // Cari target product di family yang sama
                                const targetProd = targetProducts.find(p => p.family === sourceProd.family);
                                
                                if (targetProd) {
                                  // Ambil uplift dari intraFamilyShifts (karena hitungan uplift ada di sana)
                                  const shiftData = customer.productMixStrategy.intraFamilyShifts?.find(s => s.from === sourceProd.spec && s.to === targetProd.spec);

                                  renderItems.push({
                                    type: 'shifted',
                                    source: sourceProd,
                                    target: targetProd,
                                    uplift: shiftData?.sales_uplift || 0,
                                    shiftedQty: shiftData?.shifted_qty || 0,
                                    shiftedSales: shiftData?.shifted_sales_value || 0
                                  });
                                }
                              });

                              // 3. Masukkan Original Products (Untuk kartu "No Change")
                              originalProducts.forEach(origProd => {
                                renderItems.push({
                                  type: 'no_change',
                                  source: origProd,
                                  target: origProd, // Targetnya diri sendiri
                                  uplift: 0,
                                  shiftedQty: 0,
                                  shiftedSales: 0
                                });
                              });

                              // 4. Sorting & Mapping hasil akhir
                              return renderItems
                                .sort((a, b) => (a.type === 'shifted' ? -1 : 1)) // Shifted di atas
                                .map((item, idx) => {
                                  const isShifted = item.type === 'shifted';
                                  
                                  // Variabel angka yang sudah pasti aman
                                  const currentGm = item.source.current.gmPct;
                                  const projectedGm = item.target.projected.gmPct;
                                  const currentSales = item.source.current.sales;
                                  const currentQty = item.source.current.qty;

                                  return (
                                    <div key={idx} className="flex flex-col p-3 bg-primary/5 border border-primary/20 rounded-md relative shadow-sm mt-3">
                                      
                                      {/* BADGE STATUS PRODUK */}
                                      <Badge 
                                        variant="secondary" 
                                        className={`text-[10px] px-2 py-0.5 whitespace-nowrap mb-3 w-fit border absolute -top-3 left-2 ${
                                          isShifted 
                                            ? 'bg-emerald-900/40 text-emerald-400 border-emerald-500/30' 
                                            : 'bg-slate-800 text-slate-300 border-slate-600'
                                        }`}
                                      >
                                        {isShifted ? '🔄 Product Switch' : '✅ No Change'}
                                      </Badge>

                                      {/* HEADER: Panah Produk */}
                                      <div className="flex items-center justify-between font-sm mb-3 mt-1">
                                        <span className={`text-sm font-bold truncate w-[40%] text-center rounded-lg px-1 py-0.5 ${
                                          currentGm < 9 ? 'text-red-500 bg-red-500/10 border border-red-500/20' : 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20'
                                        }`}>
                                          {item.source.spec}
                                        </span>
                                        
                                        <ArrowRight className={`w-4 h-4 shrink-0 ${!isShifted ? 'text-slate-600/30' : 'text-slate-400'}`} />
                                        
                                        <span className={`text-sm font-bold truncate w-[40%] text-center border rounded-lg px-1 py-0.5 ${
                                          !isShifted 
                                            ? 'text-slate-500 bg-slate-800 border-slate-700' 
                                            : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                                        }`}>
                                          {!isShifted ? 'No Change' : item.target.spec}
                                        </span>
                                      </div>

                                      {/* BODY: Perbandingan Current vs Projected */}
                                      <div className="grid grid-cols-2 gap-3 relative">
                                        
                                        {/* Garis pemisah tengah vertikal */}
                                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-[80%] bg-slate-700/50"></div>

                                        {/* KOLOM KIRI (Data Current) */}
                                        <div className="flex flex-col pr-2">
                                          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Current</span>

                                          <span className="text-sm font-bold text-slate-400">
                                            GM: <span className={getGmColor(currentGm)}>{currentGm.toFixed(2)}%</span>
                                          </span>

                                          {/* Dibuat flex h-4 agar tingginya sejajar dengan baris kanan yang ada badge-nya */}
                                          <div className="flex items-center mt-0.5 min-h-[1.25rem]">
                                            <span className="text-xs font-light text-slate-400">
                                              Sales: <span className={getGmColor(currentGm)}>{formatCurrency(currentSales)}</span>
                                            </span>
                                          </div>

                                          <div className="flex items-center mt-0.5 min-h-[1.25rem]">
                                            <span className="text-xs font-light text-slate-400">
                                              Qty: <span className={getGmColor(currentGm)}>{Number(currentQty).toFixed(2)}</span>
                                            </span>
                                          </div>
                                        </div>

                                        {/* KOLOM KANAN (Data Projected) */}
                                        <div className="flex flex-col pl-2">
                                          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Projected</span>
                                          <div className="flex items-center justify-between mt-0.5 min-h-[1.25rem]">
                                            <span className="text-sm font-bold text-slate-300">
                                              <span className={getGmColor(projectedGm)}>{projectedGm.toFixed(2)}%</span>
                                            </span>
                                            {isShifted && (
                                              <Badge 
                                                variant="outline" 
                                                className={`ml-2 whitespace-nowrap px-1.5 py-0 text-[9px] font-bold ${getGmColor(projectedGm)} bg-emerald-500/10 border-emerald-500/20`}
                                              >
                                                {/* Menambahkan tanda + secara manual jika selisih positif */}
                                                {(projectedGm - currentGm) > 0 ? '+' : ''}
                                                {(projectedGm - currentGm).toFixed(2)}%
                                              </Badge>
                                            )}
                                          </div>
                                          

                                          {/* Baris Sales: Teks di Kiri, Badge di Kanan */}
                                          <div className="flex items-center justify-between mt-0.5 min-h-[1.25rem]">
                                            <span className="text-xs font-light text-slate-400">
                                              <span className={getGmColor(projectedGm)}>
                                                {isShifted ? formatCurrency(item.shiftedSales) : formatCurrency(item.source.projected.sales)}
                                              </span>
                                            </span>
                                            {isShifted && (
                                              <Badge variant="outline" className={`ml-2 whitespace-nowrap px-1.5 py-0 text-[9px] font-bold ${getGmColor(projectedGm)} bg-emerald-500/10 border-emerald-500/20`}>
                                                {item.uplift < 0 ? '-' : '+'} {formatCurrency(Math.abs(item.uplift))}
                                              </Badge>
                                            )}
                                          </div>

                                          {/* Baris Qty: Teks di Kiri, Badge Qty di Kanan */}
                                          <div className="flex items-center justify-between mt-0.5 min-h-[1.25rem]">
                                            <span className="text-xs font-light text-slate-400">
                                              <span className={getGmColor(projectedGm)}>
                                                {isShifted ? Number(item.shiftedQty).toFixed(2) : Number(item.source.projected.qty).toFixed(2)}
                                              </span>
                                            </span>
                                            {/* {isShifted && (
                                              <Badge variant="outline" className={`ml-2 whitespace-nowrap px-1.5 py-0 text-[9px] font-bold ${getGmColor(projectedGm)} bg-emerald-500/10 border-emerald-500/20`}>
                                                +{Number(item.shiftedQty).toFixed(2)}
                                              </Badge>
                                            )} */}
                                          </div>
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
                    {/* AI Reasoning */}
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
                                        <span className="opacity-90">
                                          {line.replace(/^\d+\.\s/, '').replace(/"/g, '')}
                                        </span>
                                      </>
                                    ) : (
                                      <span>{line}</span>
                                    )}
                                  </div>
                                )
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
        {/* Tombol Kiri (Prev) */}
        <CarouselPrevious className="sticky-center left-0 -translate-x-1/2 bg-slate-900 text-slate-300 shadow-md border border-slate-700 hover:bg-slate-800 z-10 w-8 h-8" />
        
        {/* Tombol Kanan (Next) */}
        <CarouselNext className="sticky-center right-0 translate-x-1/2 bg-slate-900 text-slate-300 shadow-md border border-slate-700 hover:bg-slate-800 z-10 w-8 h-8" />
      </Carousel>
    </div>
  )
}