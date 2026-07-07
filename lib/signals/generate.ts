import { getSupabase } from '../db/supabase'

const NOTIONAL_THRESHOLD = 50_000

interface TradeEvent {
  coin: string
  side: string  // 'B' or 'A'
  px: string
  sz: string
  time: number
  wallets: string[]
}

interface GeneratedSignal {
  signal_id: string
  wallet_address: string
  wallet_label: string | null
  wallet_tags: string[]
  coin: string
  side: 'long' | 'short'
  entry_price: number
  notional_usd: number
  confidence: 'high' | 'medium' | 'low'
  source: string
}

/**
 * Fetch label, tags, and confidence for a wallet in a single query.
 * Confidence derives from the measured win rate (real round trips only —
 * the seed pipeline stores null when there is no evidence).
 */
async function getWalletProfile(address: string): Promise<{
  label: string | null
  tags: string[]
  confidence: 'high' | 'medium' | 'low'
}> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('wallets')
      .select('win_rate, label, tags')
      .eq('address', address)
      .single()

    let confidence: 'high' | 'medium' | 'low' = 'medium'
    if (data?.win_rate !== null && data?.win_rate !== undefined) {
      const winRate = Number(data.win_rate)
      if (winRate >= 0.6) confidence = 'high'
      else if (winRate >= 0.45) confidence = 'medium'
      else confidence = 'low'
    }

    return { label: data?.label || null, tags: data?.tags || [], confidence }
  } catch {
    return { label: null, tags: [], confidence: 'medium' }
  }
}

/**
 * Check if a trade event qualifies as a signal and generate + store it.
 * Returns only the signals that were actually persisted.
 *
 * Rate control: at most ONE active signal per wallet+coin+side. Checked
 * here before inserting, and guaranteed under concurrency by the partial
 * unique index idx_signals_one_active (migration 006) — a duplicate
 * insert from a racing stream fails and is skipped, never double-counted.
 */
export async function maybeGenerateSignal(trade: TradeEvent): Promise<GeneratedSignal[]> {
  const price = parseFloat(trade.px)
  const size = parseFloat(trade.sz)
  const notional = price * size

  // Only generate signals for trades above the notional threshold
  if (notional < NOTIONAL_THRESHOLD) return []

  const side: 'long' | 'short' = trade.side === 'B' ? 'long' : 'short'
  const signals: GeneratedSignal[] = []
  const supabase = getSupabase()

  for (const wallet of trade.wallets) {
    const address = wallet.toLowerCase()

    // Dedup pre-check (cheap common path): skip when an active signal for
    // this wallet+coin+side already exists.
    const { data: existing } = await supabase
      .from('signals')
      .select('signal_id')
      .eq('wallet_address', address)
      .eq('coin', trade.coin)
      .eq('side', side)
      .eq('status', 'active')
      .limit(1)

    if (existing && existing.length > 0) continue

    const profile = await getWalletProfile(address)

    const signal: GeneratedSignal = {
      signal_id: crypto.randomUUID(),
      wallet_address: address,
      wallet_label: profile.label,
      wallet_tags: profile.tags,
      coin: trade.coin,
      side,
      entry_price: price,
      notional_usd: Math.round(notional * 100) / 100,
      confidence: profile.confidence,
      source: 'hyperliquid_smart_money',
    }

    const { error } = await supabase.from('signals').insert({
      signal_id: signal.signal_id,
      wallet_address: signal.wallet_address,
      wallet_label: signal.wallet_label,
      wallet_tags: signal.wallet_tags,
      coin: signal.coin,
      side: signal.side,
      entry_price: signal.entry_price,
      notional_usd: signal.notional_usd,
      confidence: signal.confidence,
      source: signal.source,
      status: 'active',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })

    if (error) {
      // Unique-index violation = a racing stream inserted first — expected,
      // skip quietly. Anything else is a real persistence failure: do NOT
      // report the signal as generated (the old code pushed it regardless).
      const isDuplicate = /duplicate|unique|23505/i.test(error.message || '')
      if (!isDuplicate && process.env.NODE_ENV === 'development') {
        console.error(`[Signals] Failed to persist signal for ${address}: ${error.message}`)
      }
      continue
    }

    signals.push(signal)
  }

  return signals
}
