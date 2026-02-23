/**
 * Human-readable aliases for known top wallets.
 * Key: full lowercase address or prefix (first 6 + last 4 hex chars).
 */
const WALLET_ALIASES: Record<string, string> = {
  '0x348e5365acfa48a26ada7da840ca611e29c950ef': 'Apex Momentum',
  '0x7a23e91f': 'Ghost Trader',
  '0xa33a1ff8': 'Whale #2',
  '0xbb82e19f': 'Precision #3',
  '0x51f62b39': 'Conviction Bull',
  '0xd1e4cc07': 'Scalp King',
  '0x3f8b22a4': 'Delta Farmer',
}

/**
 * Look up a wallet alias by full address.
 * Tries full address match first, then prefix+suffix match.
 */
export function getWalletAlias(address: string): string | null {
  if (!address) return null
  const lower = address.toLowerCase()

  // Full address match
  if (WALLET_ALIASES[lower]) return WALLET_ALIASES[lower]

  // Prefix+suffix match (first 6 + last 4 chars of hex)
  const short = lower.slice(0, 6) + lower.slice(-4)
  if (WALLET_ALIASES[short]) return WALLET_ALIASES[short]

  return null
}

/**
 * Get truncated address: 0x1234...abcd
 */
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
