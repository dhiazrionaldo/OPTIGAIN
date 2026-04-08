/**
 * Format large numbers to compact format with Indonesian-friendly abbreviations
 * 1000000 → 1M
 * 1500000 → 1,5M
 * 1000000000 → 1T (Triliun)
 */
export function formatCompactNumber(value: number): string {
  const absValue = Math.abs(value)
  
  if (absValue >= 1_000_000_000) {
    return (value / 1_000_000_000).toLocaleString("id-ID", {
      maximumFractionDigits: 1,
    }) + "T"
  } else if (absValue >= 1_000_000) {
    return (value / 1_000_000).toLocaleString("id-ID", {
      maximumFractionDigits: 1,
    }) + "M"
  } else if (absValue >= 1_000) {
    return (value / 1_000).toLocaleString("id-ID", {
      maximumFractionDigits: 1,
    }) + "K"
  }
  
  return value.toLocaleString("id-ID", {
    maximumFractionDigits: 0,
  })
}

/**
 * Format number as currency with Indonesian locale
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Format number as compact currency
 * Useful for charts where space is limited
 */
export function formatCompactCurrency(value: number): string {
  return "Rp " + formatCompactNumber(value)
}
