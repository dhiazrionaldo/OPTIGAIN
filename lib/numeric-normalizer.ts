/**
 * Normalizes Indonesian number format to standard decimal format.
 * Indonesian format uses dots as thousand separators and commas as decimal separators.
 *
 * Examples:
 *   "400.000.000" → 400000000
 *   "1.234.567,89" → 1234567.89
 *   "0,9" → 0.9
 *   "1234" → 1234
 *   "1,234.56" → 1234.56 (US format passthrough)
 */
export function normalizeNumber(value: unknown): number {
  if (typeof value === "number") {
    return value
  }

  if (value === null || value === undefined || value === "") {
    return 0
  }

  const str = String(value).trim()

  // If the string has no dots and no commas, parse directly
  if (!str.includes(".") && !str.includes(",")) {
    const parsed = parseFloat(str)
    return isNaN(parsed) ? 0 : parsed
  }

  // Detect Indonesian format: has dots as thousand separators
  // Pattern: digits separated by dots (e.g., "400.000.000")
  // or digits with dot thousands and comma decimal (e.g., "1.234.567,89")
  const dotCount = (str.match(/\./g) || []).length
  const commaCount = (str.match(/,/g) || []).length

  if (dotCount > 1 || (dotCount >= 1 && commaCount === 1)) {
    // Indonesian format: dots are thousands, comma is decimal
    const normalized = str.replace(/\./g, "").replace(",", ".")
    const parsed = parseFloat(normalized)
    return isNaN(parsed) ? 0 : parsed
  }

  if (commaCount === 1 && dotCount === 0) {
    // Could be Indonesian decimal (e.g., "0,9") or European format
    const normalized = str.replace(",", ".")
    const parsed = parseFloat(normalized)
    return isNaN(parsed) ? 0 : parsed
  }

  // US format passthrough (e.g., "1,234.56")
  if (commaCount >= 1 && dotCount === 1) {
    const normalized = str.replace(/,/g, "")
    const parsed = parseFloat(normalized)
    return isNaN(parsed) ? 0 : parsed
  }

  // Fallback: try parsing as-is
  const parsed = parseFloat(str.replace(/,/g, ""))
  return isNaN(parsed) ? 0 : parsed
}
