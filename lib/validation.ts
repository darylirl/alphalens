// Input validation utilities

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

/**
 * Validate an Ethereum address format.
 * Returns the checksummed (lowercased) address or null if invalid.
 */
export function validateAddress(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!ETH_ADDRESS_RE.test(trimmed)) return null
  return trimmed.toLowerCase()
}

/**
 * Validate that a string is a safe Supabase column name for ordering.
 * Only allows alphanumeric characters and underscores.
 */
const ALLOWED_SORT_COLUMNS = new Set([
  'sharpe_30d', 'sharpe_7d', 'sharpe_90d',
  'total_pnl_usd', 'win_rate', 'alpha_decay_score',
  'trade_count_30d', 'avg_leverage', 'avg_hold_seconds',
  'archetype_confidence', 'created_at',
])

export function validateSortColumn(input: unknown): string {
  if (typeof input !== 'string') return 'sharpe_30d'
  if (ALLOWED_SORT_COLUMNS.has(input)) return input
  return 'sharpe_30d'
}

/**
 * Safely parse a numeric query parameter.
 * Returns the parsed number if valid and within bounds, else defaultValue.
 */
export function safeParseInt(input: string | null, defaultValue: number, min = 0, max = 10000): number {
  if (!input) return defaultValue
  const n = parseInt(input, 10)
  if (isNaN(n) || n < min || n > max) return defaultValue
  return n
}

export function safeParseFloat(input: string | null, defaultValue: number, min = -1e12, max = 1e12): number {
  if (!input) return defaultValue
  const n = parseFloat(input)
  if (isNaN(n) || n < min || n > max) return defaultValue
  return n
}

/**
 * Sanitize a string for safe display (prevent XSS in SSR contexts).
 * Strips HTML tags and limits length.
 */
export function sanitizeString(input: unknown, maxLength = 500): string {
  if (typeof input !== 'string') return ''
  return input.replace(/[<>&"']/g, '').slice(0, maxLength)
}
