/**
 * Wallet display aliases.
 *
 * Honesty contract: NO invented persona names. The previous version mapped
 * fabricated brand names ("Apex Momentum", "Ghost Trader", …) onto real
 * addresses — including 8-char prefix entries that could collide with
 * unrelated wallets. All of that is removed. An alias may only be added here
 * for a verified real address, with a factual label (e.g. a publicly
 * self-identified trader or a protocol treasury), never an invented persona.
 * User-set labels live in the wallets table (label column), not here.
 */
const WALLET_ALIASES: Record<string, string> = {
  // intentionally empty — see honesty contract above
}

/**
 * Look up a wallet alias by full lowercase address. Exact match only:
 * prefix matching was removed because it could mislabel unrelated wallets.
 */
export function getWalletAlias(address: string): string | null {
  if (!address) return null
  return WALLET_ALIASES[address.toLowerCase()] ?? null
}

/**
 * Get truncated address: 0x1234...abcd
 */
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
