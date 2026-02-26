import * as XLSX from "xlsx"
import { normalizeNumber } from "./numeric-normalizer"
import { validateFormulas } from "./formula-validator"

const REQUIRED_HEADERS = [
  "customer",
  "kog & thickness",
  "qty",
  "amt.sales",
  "freight cost",
  "nett.sales",
  "cogs",
  "gm value",
  "gm (%)",
] as const

const HEADER_MAP: Record<string, string> = {
  customer: "customer_name",
  "kog & thickness": "product_spec",
  qty: "quantity",
  "amt.sales": "amount_sales",
  "freight cost": "freight_cost",
  "nett.sales": "net_sales",
  cogs: "cogs",
  "gm value": "gross_margin_value",
  "gm (%)": "gross_margin_percent",
}

export interface ParsedRow {
  customer_name: string
  product_spec: string
  quantity: number
  amount_sales: number
  freight_cost: number
  net_sales: number
  cogs: number
  gross_margin_value: number
  gross_margin_percent: number
  status: string | null
  warnings: string[]
  sheet_month?: number
  sheet_year?: number
}

export interface ParseResult {
  success: boolean
  rows: ParsedRow[]
  errors: string[]
  totalWarnings: number
  // optional month/year info parsed from the sheet name (e.g. Jan'26)
  sheetMonth?: number
  sheetYear?: number
}

/**
 * Expand merged Excel cells so all rows receive the merged value.
 * Without this, sheet_to_json only keeps the value in the first cell.
 */
function expandMergedCells(sheet: XLSX.WorkSheet) {
  const merges = sheet["!merges"]
  if (!merges) return

  for (const merge of merges) {
    const start = merge.s
    const end = merge.e

    const startCellRef = XLSX.utils.encode_cell(start)
    const startCell = sheet[startCellRef]
    if (!startCell) continue

    for (let r = start.r; r <= end.r; r++) {
      for (let c = start.c; c <= end.c; c++) {
        if (r === start.r && c === start.c) continue

        const cellRef = XLSX.utils.encode_cell({ r, c })
        sheet[cellRef] = {
          t: startCell.t,
          v: startCell.v,
          w: startCell.w,
        }
      }
    }
  }
}

// Parse a sheet name to extract a month/year if present. Supports formats like
// "Sales Jan'26 by Cust.& KOG" or "Sales Feb 2026" etc.
function parseSheetDate(sheetName: string): { month: number; year: number } | null {
  // look for three-letter month followed by optional apostrophe and 2-4 digit year
  const m = sheetName.match(/([A-Za-z]{3})\s*'?((?:\d{2})|(?:\d{4}))/)
  if (!m) return null

  const monthStr = m[1].toLowerCase()
  const monthNames = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ]
  const monthIndex = monthNames.indexOf(monthStr)
  if (monthIndex === -1) return null

  let yearNum = parseInt(m[2], 10)
  if (yearNum < 100) {
    // assume 2000s for two-digit years
    yearNum += 2000
  }

  return { month: monthIndex + 1, year: yearNum }
}

// Heuristic for rows that represent the totals/summary line in the sheet. They
// typically have the word "total" in the customer column (or product column)
// and are not actual customer/product data.
function isTotalRow(customer: string, product: string): boolean {
  const combined = `${customer} ${product}`.toLowerCase()
  return combined.includes("total") || combined.includes("subtotal")
}


export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
  const errors: string[] = []

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: "array" })
  } catch {
    return {
      success: false,
      rows: [],
      errors: ["Failed to read Excel file. Please upload a valid .xlsx file."],
      totalWarnings: 0,
    }
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return {
      success: false,
      rows: [],
      errors: ["No sheets found in the Excel file."],
      totalWarnings: 0,
    }
  }

  let totalWarnings = 0
  const rows: ParsedRow[] = []
  let headerIndex: Record<string, string> | null = null

  // Process all sheets in the workbook
  for (const sheetName of workbook.SheetNames) {
    // Parse sheet date from name (e.g., "Sales Jan'26" -> month=1, year=2026)
    const sheetDate = parseSheetDate(sheetName)

    const sheet = workbook.Sheets[sheetName]

    // ⭐ FIX: populate merged cells BEFORE converting to JSON
    expandMergedCells(sheet)

    const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })

    if (rawData.length === 0) {
      continue // skip empty sheets
    }

    // Validate headers (only on first sheet)
    if (!headerIndex) {
      const firstRow = rawData[0]
      const actualHeaders = Object.keys(firstRow).map((h) => h.toLowerCase().trim())

      const missingHeaders: string[] = []
      for (const required of REQUIRED_HEADERS) {
        if (!actualHeaders.some((h) => h === required)) {
          missingHeaders.push(required)
        }
      }

      if (missingHeaders.length > 0) {
        return {
          success: false,
          rows: [],
          errors: [`Missing required headers: ${missingHeaders.join(", ")}`],
          totalWarnings: 0,
        }
      }

      // Build header index mapping
      headerIndex = {}
      const originalHeaders = Object.keys(firstRow)
      for (const original of originalHeaders) {
        const lower = original.toLowerCase().trim()
        if (HEADER_MAP[lower]) {
          headerIndex[original] = HEADER_MAP[lower]
        }
      }
    }

    // Parse rows from this sheet
    for (let i = 0; i < rawData.length; i++) {
      const raw = rawData[i]

      const mapped: Record<string, unknown> = {}
      for (const [originalHeader, fieldName] of Object.entries(headerIndex)) {
        mapped[fieldName] = raw[originalHeader]
      }

      const customerName = String(mapped.customer_name || "").trim()
      const productSpec = String(mapped.product_spec || "").trim()

      // Skip completely empty rows
      if (!customerName && !productSpec) continue

      // filter out totals/summary lines
      if (isTotalRow(customerName, productSpec)) continue

      const quantity = normalizeNumber(mapped.quantity)
      const amountSales = normalizeNumber(mapped.amount_sales)
      const freightCost = normalizeNumber(mapped.freight_cost)
      const netSales = normalizeNumber(mapped.net_sales)
      const cogs = normalizeNumber(mapped.cogs)
      const grossMarginValue = normalizeNumber(mapped.gross_margin_value)
      const grossMarginPercent = normalizeNumber(mapped.gross_margin_percent)

      const validation = validateFormulas({
        amount_sales: amountSales,
        freight_cost: freightCost,
        net_sales: netSales,
        cogs,
        gross_margin_value: grossMarginValue,
        gross_margin_percent: grossMarginPercent,
      })

      const status = validation.isValid ? null : "formula_mismatch"
      if (!validation.isValid) {
        totalWarnings += validation.warnings.length
      }

      rows.push({
        customer_name: customerName,
        product_spec: productSpec,
        quantity,
        amount_sales: amountSales,
        freight_cost: freightCost,
        net_sales: netSales,
        cogs,
        gross_margin_value: grossMarginValue,
        gross_margin_percent: grossMarginPercent,
        status,
        warnings: validation.warnings,
        sheet_month: sheetDate?.month,
        sheet_year: sheetDate?.year,
      })
    }
  }

  if (rows.length === 0) {
    return {
      success: false,
      rows: [],
      errors: ["No valid data rows found in any sheet."],
      totalWarnings: 0,
    }
  }

  return {
    success: true,
    rows,
    errors,
    totalWarnings,
  }
}

// import * as XLSX from "xlsx"
// import { normalizeNumber } from "./numeric-normalizer"
// import { validateFormulas } from "./formula-validator"

// const REQUIRED_HEADERS = [
//   "customer",
//   "kog & thickness",
//   "qty",
//   "amt.sales",
//   "freight cost",
//   "nett.sales",
//   "cogs",
//   "gm value",
//   "gm (%)",
// ] as const

// const HEADER_MAP: Record<string, string> = {
//   customer: "customer_name",
//   "kog & thickness": "product_spec",
//   qty: "quantity",
//   "amt.sales": "amount_sales",
//   "freight cost": "freight_cost",
//   "nett.sales": "net_sales",
//   cogs: "cogs",
//   "gm value": "gross_margin_value",
//   "gm (%)": "gross_margin_percent",
// }

// export interface ParsedRow {
//   customer_name: string
//   product_spec: string
//   quantity: number
//   amount_sales: number
//   freight_cost: number
//   net_sales: number
//   cogs: number
//   gross_margin_value: number
//   gross_margin_percent: number
//   status: string | null
//   warnings: string[]
// }

// export interface ParseResult {
//   success: boolean
//   rows: ParsedRow[]
//   errors: string[]
//   totalWarnings: number
// }

// export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
//   const errors: string[] = []

//   let workbook: XLSX.WorkBook
//   try {
//     workbook = XLSX.read(buffer, { type: "array" })
//   } catch {
//     return { success: false, rows: [], errors: ["Failed to read Excel file. Please upload a valid .xlsx file."], totalWarnings: 0 }
//   }

//   const sheetName = workbook.SheetNames[0]
//   if (!sheetName) {
//     return { success: false, rows: [], errors: ["No sheets found in the Excel file."], totalWarnings: 0 }
//   }

//   const sheet = workbook.Sheets[sheetName]
//   const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })

//   if (rawData.length === 0) {
//     return { success: false, rows: [], errors: ["The Excel sheet is empty."], totalWarnings: 0 }
//   }

//   // Validate headers
//   const firstRow = rawData[0]
//   const actualHeaders = Object.keys(firstRow).map((h) => h.toLowerCase().trim())

//   const missingHeaders: string[] = []
//   for (const required of REQUIRED_HEADERS) {
//     if (!actualHeaders.some((h) => h === required)) {
//       missingHeaders.push(required)
//     }
//   }

//   if (missingHeaders.length > 0) {
//     return {
//       success: false,
//       rows: [],
//       errors: [`Missing required headers: ${missingHeaders.join(", ")}`],
//       totalWarnings: 0,
//     }
//   }

//   // Build header index mapping (case-insensitive)
//   const headerIndex: Record<string, string> = {}
//   const originalHeaders = Object.keys(firstRow)
//   for (const original of originalHeaders) {
//     const lower = original.toLowerCase().trim()
//     if (HEADER_MAP[lower]) {
//       headerIndex[original] = HEADER_MAP[lower]
//     }
//   }

//   let totalWarnings = 0
//   const rows: ParsedRow[] = []

//   for (let i = 0; i < rawData.length; i++) {
//     const raw = rawData[i]

//     // Map raw data to typed row
//     const mapped: Record<string, unknown> = {}
//     for (const [originalHeader, fieldName] of Object.entries(headerIndex)) {
//       mapped[fieldName] = raw[originalHeader]
//     }

//     const customerName = String(mapped.customer_name || "").trim()
//     const productSpec = String(mapped.product_spec || "").trim()

//     // Skip completely empty rows
//     if (!customerName && !productSpec) {
//       continue
//     }

//     const quantity = normalizeNumber(mapped.quantity)
//     const amountSales = normalizeNumber(mapped.amount_sales)
//     const freightCost = normalizeNumber(mapped.freight_cost)
//     const netSales = normalizeNumber(mapped.net_sales)
//     const cogs = normalizeNumber(mapped.cogs)
//     const grossMarginValue = normalizeNumber(mapped.gross_margin_value)
//     const grossMarginPercent = normalizeNumber(mapped.gross_margin_percent)

//     // Validate formulas
//     const validation = validateFormulas({
//       amount_sales: amountSales,
//       freight_cost: freightCost,
//       net_sales: netSales,
//       cogs,
//       gross_margin_value: grossMarginValue,
//       gross_margin_percent: grossMarginPercent,
//     })

//     const status = validation.isValid ? null : "formula_mismatch"
//     if (!validation.isValid) {
//       totalWarnings += validation.warnings.length
//     }

//     rows.push({
//       customer_name: customerName,
//       product_spec: productSpec,
//       quantity,
//       amount_sales: amountSales,
//       freight_cost: freightCost,
//       net_sales: netSales,
//       cogs,
//       gross_margin_value: grossMarginValue,
//       gross_margin_percent: grossMarginPercent,
//       status,
//       warnings: validation.warnings,
//     })
//   }

//   return {
//     success: true,
//     rows,
//     errors,
//     totalWarnings,
//   }
// }
