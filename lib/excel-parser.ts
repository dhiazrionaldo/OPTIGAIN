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
  sheetMonth?: number
  sheetYear?: number
}

/**
 * Expand merged Excel cells so all rows receive the merged value.
 * Without this, sheet_to_json only keeps the value in the first cell.
 */
// function expandMergedCells(sheet: XLSX.WorkSheet) {
//   const merges = sheet["!merges"]
//   if (!merges) return

//   for (const merge of merges) {
//     const start = merge.s
//     const end = merge.e

//     const startCellRef = XLSX.utils.encode_cell(start)
//     const startCell = sheet[startCellRef]
//     if (!startCell) continue

//     for (let r = start.r; r <= end.r; r++) {
//       for (let c = start.c; c <= end.c; c++) {
//         if (r === start.r && c === start.c) continue
//         const cellRef = XLSX.utils.encode_cell({ r, c })
//         sheet[cellRef] = {
//           t: startCell.t,
//           v: startCell.v,
//           w: startCell.w,
//         }
//       }
//     }
//   }
// }

function expandMergedCells(sheet: XLSX.WorkSheet) {
  const merges = sheet["!merges"]
  if (!merges) return

  // Dapatkan batas awal sheet
  let range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1")
  let needsRefUpdate = false

  for (const merge of merges) {
    const start = merge.s
    const end = merge.e

    // Update range jika ada merge cell yang keluar dari batas
    if (start.c < range.s.c) { range.s.c = start.c; needsRefUpdate = true }
    if (start.r < range.s.r) { range.s.r = start.r; needsRefUpdate = true }
    if (end.c > range.e.c) { range.e.c = end.c; needsRefUpdate = true }
    if (end.r > range.e.r) { range.e.r = end.r; needsRefUpdate = true }

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

  // Set ulang batas data yang valid agar terbaca sheet_to_json
  if (needsRefUpdate) {
    sheet["!ref"] = XLSX.utils.encode_range(range)
  }
}

// Parse a sheet name to extract a month/year if present.
// Supports formats like "Sales Jan'26 by Cust.& KOG" or "Sales Feb 2026" etc.
function parseSheetDate(sheetName: string): { month: number; year: number } | null {
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun",
                      "jul", "aug", "sep", "oct", "nov", "dec"]

  // Match 3-4 letter month abbreviations (handles "Sept" as well as "Sep")
  const m = sheetName.match(/([A-Za-z]{3,4})\s*'?(\d{2,4})/)
  if (!m) return null

  // Normalize "sept" → "sep" before lookup
  let monthStr = m[1].toLowerCase()
  if (monthStr === "sept") monthStr = "sep"

  const monthIndex = monthNames.indexOf(monthStr)
  if (monthIndex === -1) return null

  let year = parseInt(m[2], 10)
  if (year < 100) year += 2000

  return { month: monthIndex + 1, year }
}
// function parseSheetDate(sheetName: string): { month: number; year: number } | null {
//   const m = sheetName.match(/([A-Za-z]{3})\s*'?((?:\d{2})|(?:\d{4}))/)
//   if (!m) return null

//   const monthStr = m[1].toLowerCase()
//   const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
//   const monthIndex = monthNames.indexOf(monthStr)
//   if (monthIndex === -1) return null

//   let yearNum = parseInt(m[2], 10)
//   if (yearNum < 100) yearNum += 2000

//   return { month: monthIndex + 1, year: yearNum }
// }

// Heuristic for rows that represent totals/summary lines in the sheet.
function isTotalRow(customer: string, product: string): boolean {
  const combined = `${customer} ${product}`.toLowerCase()
  return combined.includes("total") || combined.includes("subtotal")
}

/**
 * A valid product spec always contains at least one letter (e.g. "FL 3 mm", "DG 5 mm").
 * If product_spec is a bare number it means the cell lost its shared-string type
 * metadata during export — the value is a raw shared-string index, not an actual
 * product name. These rows must be skipped.
 */
function isValidProductSpec(value: string): boolean {
  return value.length > 0 && /[a-zA-Z]/.test(value)
}

export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
  const errors: string[] = []

  let workbook: XLSX.WorkBook
  try {
    // FIX 1: cellFormula:false reads cached cell values instead of formula strings.
    //         raw:true returns unformatted numeric values so number formats like
    //         "#,##0_ ;[Red]\-#,##0\ " are never mistaken for data.
    workbook = XLSX.read(buffer, {
      type: "array",
      cellFormula: false,
      cellText: false,
      raw: true,
    })
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

  for (const sheetName of workbook.SheetNames) {
    const sheetDate = parseSheetDate(sheetName)
    const sheet = workbook.Sheets[sheetName]

    // Expand merged cells BEFORE converting to a 2D array
    expandMergedCells(sheet)

    // FIX 2: Use header:1 to get a raw 2D array so we can locate the actual
    //         header row ourselves — the sheet may have title rows above it.
    const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
    })

    if (rawMatrix.length === 0) continue

    // Scan the first 10 rows to find whichever row contains "customer"
    // Scan baris (perbesar dari 10 jadi 50) untuk mencari header
    let headerRowIndex = -1
    for (let r = 0; r < Math.min(rawMatrix.length, 50); r++) {
      const row = rawMatrix[r] as unknown[]
      const hasCustomer = row.some(
        // Replace semua tipe whitespace/enter jadi 1 spasi agar matching-nya presisi
        (cell) => String(cell).toLowerCase().replace(/\s+/g, " ").trim() === "customer"
      )
      if (hasCustomer) {
        headerRowIndex = r
        break
      }
    }

    if (headerRowIndex === -1) continue

    const headerRow = (rawMatrix[headerRowIndex] as unknown[]).map((h) =>
      String(h).toLowerCase().replace(/\s+/g, " ").trim()
    )

    // Validate required headers on the first sheet only
    const isFirstSheet = rows.length === 0
    if (isFirstSheet) {
      const missingHeaders: string[] = []
      for (const required of REQUIRED_HEADERS) {
        if (!headerRow.some((h) => h === required)) {
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
    }

    // FIX 3: Build headerIndex by column INDEX (not header name string) so it is
    //         immune to whitespace/casing differences between sheets, and rebuild
    //         it fresh for every sheet so column positions don't bleed across sheets.
    const headerIndex: Record<number, string> = {}
    for (let c = 0; c < headerRow.length; c++) {
      const mapped = HEADER_MAP[headerRow[c]]
      if (mapped) headerIndex[c] = mapped
    }

    const customerColIndex = headerRow.indexOf("customer")
    if (customerColIndex === -1) continue

    // FIX 4: Reset forward-fill state at the start of each sheet so the last
    //         customer from a previous sheet never bleeds into this one.
    let lastCustomer = ""

    for (let r = headerRowIndex + 1; r < rawMatrix.length; r++) {
      const rawRow = rawMatrix[r] as unknown[]

      // Forward-fill customer name for merged cells
      const rawCustomer = String(rawRow[customerColIndex] ?? "").trim()
      if (rawCustomer !== "") {
        lastCustomer = rawCustomer
      }
      const customerName = lastCustomer

      // Map each column by its index to the correct field name
      const mapped: Record<string, unknown> = {}
      for (const [colIndexStr, fieldName] of Object.entries(headerIndex)) {
        mapped[fieldName] = rawRow[Number(colIndexStr)]
      }

      const productSpec = String(mapped.product_spec ?? "").trim()

      // Skip completely empty rows
      if (!customerName && !productSpec) continue

      // Skip totals / summary rows
      if (isTotalRow(customerName, productSpec)) continue

      // FIX 5: Guard against rows where the product_spec cell lost its
      //         shared-string type attribute during export. In that case XLSX.js
      //         returns the raw shared-string index (a plain number like 12)
      //         instead of the actual string value (e.g. "DG 5 mm").
      //         A real product spec always contains at least one letter.
      if (!isValidProductSpec(productSpec)) continue

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