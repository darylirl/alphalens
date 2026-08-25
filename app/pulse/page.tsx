import { getSupabase } from '@/lib/db/supabase'
import { BottomNav } from '@/components/layout/BottomNav'
import { CaptureCoverageStrip, loadCaptureStatus } from '@/components/layout/CaptureCoverageStrip'

// Public, no login, server-rendered for sub-1s FCP: all data comes from the
// pulse_24h materialized view (captured fills, refreshed every 30 minutes by
// pg_cron) — no live exchange calls on this path, no per-wallet data, and
// none of the deprecated wallet confidence scores.
// Server-rendered per request rather than prerendered at build time: the
// build must not depend on the database being reachable (a build-time Supabase
// call that hangs fails the whole deployment). This trades ISR caching for
// build independence; the read is a single small matview query.
export const dynamic = 'force-dynamic'

interface PulseRow {
  coin: string
  notional_24h: number
  net_flow_24h: number
  new_longs_24h: number
  new_shorts_24h: number
  new_notional_24h: number
  add_notional_24h: number
  wallets_24h: number
  notional_prev: number
  net_flow_prev: number
  computed_at: string
}

function usd(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toFixed(0)}`
}

function ago(ts: string | null): string {
  if (!ts) return '—'
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

async function loadPulse() {
  const supabase = getSupabase()
  const capture = await loadCaptureStatus(supabase)
  try {
    // capture_health filtering lives in loadCaptureStatus (shared with
    // /ledger): capture-daemon rows only, wallets_polled null-fallback.
    const { data: rows } = await supabase
      .from('pulse_24h').select('*').order('notional_24h', { ascending: false }).limit(30)
    return { rows: (rows || []) as PulseRow[], ...capture }
  } catch {
    return { rows: [] as PulseRow[], ...capture }
  }
}

export default async function PulsePage() {
  const { rows, lastHeartbeat, walletsTracked, captureSince } = await loadPulse()
  const computedAt = rows[0]?.computed_at ?? null

  const coins = rows
    .filter(r => Number(r.notional_24h) > 0)
    // "@107"-style coins are Hyperliquid's internal spot-pair ids. We hold no
    // verified id->symbol mapping (and this path makes no live exchange
    // calls), so unmapped ids are excluded rather than shown raw or guessed.
    .filter(r => !/^@\d+$/.test(r.coin))
    .map(r => {
      const notional = Number(r.notional_24h)
      const netFlow = Number(r.net_flow_24h)
      const longPct = Math.min(100, Math.max(0, Math.round(((notional + netFlow) / (2 * notional)) * 100)))
      const prevNotional = Number(r.notional_prev)
      const prevLongPct = prevNotional > 0
        ? Math.min(100, Math.max(0, Math.round(((prevNotional + Number(r.net_flow_prev)) / (2 * prevNotional)) * 100)))
        : null
      return {
        coin: r.coin,
        notional,
        longPct,
        deltaPp: prevLongPct !== null ? longPct - prevLongPct : null,
        newCount: Number(r.new_longs_24h) + Number(r.new_shorts_24h),
        newNotional: Number(r.new_notional_24h),
        addNotional: Number(r.add_notional_24h),
        wallets: Number(r.wallets_24h),
      }
    })

  return (
    <div className="pb-20 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold mb-1">Pulse</h1>
          <p className="text-white/55 text-xs">
            What the tracked cohort is doing on Hyperliquid, aggregated over
            rolling 24h from captured fills. No individual wallets, no
            recommendations.
          </p>
        </div>

        {/* Data coverage — real capture status, never fabricated */}
        <CaptureCoverageStrip
          lastHeartbeat={lastHeartbeat}
          walletsTracked={walletsTracked}
          captureSince={captureSince}
          refreshNote={`data refreshed every 30 min${computedAt ? ` · computed ${ago(computedAt)}` : ''}`}
        />

        {coins.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm font-semibold mb-1">No captured positioning yet</p>
            <p className="text-white/40 text-xs">
              This page renders only from data the capture pipeline actually
              recorded. It fills in as capture accumulates.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {coins.map(c => (
              <div key={c.coin} className="card p-3">
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-sm">{c.coin}</span>
                    <span className="text-[10px] text-white/40">{c.wallets} wallets</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-semibold">{usd(c.notional)}</span>
                    {c.deltaPp !== null && c.deltaPp !== 0 && (
                      <span className={`text-[10px] font-mono ${c.deltaPp > 0 ? 'text-[#34EAB9]' : 'text-[#FF3B5C]'}`}>
                        {c.deltaPp > 0 ? '▲' : '▼'}{Math.abs(c.deltaPp)}pp
                      </span>
                    )}
                  </div>
                </div>

                {/* Long/short skew bar */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-[#34EAB9] w-8">{c.longPct}%L</span>
                  <div className="flex-1 h-1.5 bg-[#FF3B5C]/30 rounded-full overflow-hidden">
                    <div className="h-full bg-[#34EAB9] rounded-full" style={{ width: `${c.longPct}%` }} />
                  </div>
                  <span className="text-[10px] text-[#FF3B5C] w-8 text-right">{100 - c.longPct}%S</span>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-white/40">
                  <span>{c.newCount} new positions ({usd(c.newNotional)})</span>
                  <span>adds {usd(c.addNotional)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-white/30 text-center pb-2">
          Aggregated flow direction from exchange-reported fill types. USD
          figures are traded notional, not open interest. Nothing here is a
          recommendation.
        </p>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
