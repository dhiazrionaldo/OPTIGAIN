export interface ValidationResult {
  isValid: boolean
  warnings: string[]
}

const TOLERANCE = 0.01 // Allow small rounding differences

/**
 * Validates the business formulas for a gross profit row:
 * - Net Sales = Amount Sales - Freight Cost
 * - GM Value = Net Sales - COGS
 * - GM % = GM Value / Net Sales
 */
export function validateFormulas(row: {
  amount_sales: number
  freight_cost: number
  net_sales: number
  cogs: number
  gross_margin_value: number
  gross_margin_percent: number
}): ValidationResult {
  const warnings: string[] = []

  // Net Sales = Amount Sales - Freight Cost
  const expectedNetSales = row.amount_sales - row.freight_cost
  if (Math.abs(expectedNetSales - row.net_sales) > TOLERANCE * Math.abs(expectedNetSales || 1)) {
    warnings.push(
      `Net Sales mismatch: expected ${expectedNetSales.toFixed(2)}, got ${row.net_sales.toFixed(2)}`
    )
  }

  // GM Value = Net Sales - COGS
  const expectedGMValue = row.net_sales - row.cogs
  if (Math.abs(expectedGMValue - row.gross_margin_value) > TOLERANCE * Math.abs(expectedGMValue || 1)) {
    warnings.push(
      `GM Value mismatch: expected ${expectedGMValue.toFixed(2)}, got ${row.gross_margin_value.toFixed(2)}`
    )
  }

  // GM % = GM Value / Net Sales (as a percentage or ratio)
  if (row.net_sales !== 0) {
    const expectedGMPercent = (row.gross_margin_value / row.net_sales) * 100
    const actualGMPercent =
      row.gross_margin_percent > 1
        ? row.gross_margin_percent
        : row.gross_margin_percent * 100

    if (Math.abs(expectedGMPercent - actualGMPercent) > 1) {
      warnings.push(
        `GM % mismatch: expected ${expectedGMPercent.toFixed(2)}%, got ${actualGMPercent.toFixed(2)}%`
      )
    }
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  }
}
