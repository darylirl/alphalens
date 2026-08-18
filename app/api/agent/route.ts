import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/db/supabase'

const HL_URL = 'https://api.hyperliquid.xyz/info'

async function hlPost(payload: Record<string, unknown>) {
  const res = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Hyperliquid API ${res.status}`)
  return res.json()
}

// ── Tool definitions for the agent ──────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: 'search_wallets',
    description:
      'Search the tracked wallets database with filters. Returns wallets matching the criteria, sorted by the chosen column. Use this to find wallets by PnL, win rate, Sharpe ratio, archetype, leverage, or trade count.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sort_by: {
          type: 'string',
          enum: [
            'total_pnl_usd',
            'win_rate',
            'sharpe_30d',
            'sharpe_90d',
            'alpha_decay_score',
            'trade_count_30d',
            'avg_leverage',
          ],
          description: 'Column to sort results by (descending)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (1-100, default 10)',
        },
        archetype: {
          type: 'string',
          enum: [
            'market_maker',
            'momentum_trader',
            'basis_trader',
            'whale',
            'scalper',
            'swing_trader',
          ],
          description: 'Filter by trader archetype',
        },
        min_pnl: {
          type: 'number',
          description: 'Minimum total PnL in USD',
        },
        min_win_rate: {
          type: 'number',
          description: 'Minimum win rate (0.0 to 1.0)',
        },
        min_sharpe: {
          type: 'number',
          description: 'Minimum 30-day Sharpe ratio',
        },
        max_leverage: {
          type: 'number',
          description: 'Maximum average leverage',
        },
        min_trades: {
          type: 'number',
          description: 'Minimum 30-day trade count',
        },
      },
      required: ['sort_by'],
    },
  },
  {
    name: 'get_wallet_state',
    description:
      'Get the current state of a specific wallet from Hyperliquid. Returns account value, margin, open positions with entry prices, leverage, unrealised PnL, and liquidation prices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Ethereum wallet address (0x...)',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_wallet_pnl',
    description:
      'Get historical PnL data for a wallet. Returns cumulative PnL over different timeframes (day, week, month, all-time) from the Hyperliquid portfolio endpoint.',
    input_schema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Ethereum wallet address (0x...)',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_wallet_fills',
    description:
      'Get recent trade fills for a wallet. Returns the last N days of executed trades including asset, side (buy/sell), size, price, and realised PnL per trade.',
    input_schema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Ethereum wallet address (0x...)',
        },
        days: {
          type: 'number',
          description: 'Number of days to look back (default 7, max 90)',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_market_overview',
    description:
      'Get current Hyperliquid market data: total 24h volume, open interest, top gainers/losers with price changes, and number of listed assets.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_asset_info',
    description:
      'Get detailed info for a specific asset/token on Hyperliquid: current price, 24h change, volume, open interest, and funding rate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        asset: {
          type: 'string',
          description: 'Asset symbol (e.g. ETH, BTC, HYPE, SOL)',
        },
      },
      required: ['asset'],
    },
  },
  {
    name: 'scan_wallets_by_period',
    description:
      'Scan ALL tracked wallets to find those with the highest realized PnL or return percentage over a custom time period (e.g. last 3 days, last 2 weeks). Fetches live trade data from Hyperliquid for every wallet in the database and computes exact returns. Use this for any query about profits/returns over a specific number of days.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look back (1-90)',
        },
        min_return_pct: {
          type: 'number',
          description: 'Minimum return percentage to filter by (e.g. 100 for 100%+). Optional.',
        },
        min_pnl_usd: {
          type: 'number',
          description: 'Minimum realized PnL in USD for the period. Optional.',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 10, max 20)',
        },
      },
      required: ['days'],
    },
  },
]

// ── Tool execution ──────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case 'search_wallets': {
      const sortBy = (input.sort_by as string) || 'total_pnl_usd'
      const limit = Math.min(Math.max((input.limit as number) || 10, 1), 100)

      let query = getSupabase()
        .from('wallets')
        .select(
          'address, label, archetype, archetype_confidence, sharpe_7d, sharpe_30d, sharpe_90d, win_rate, total_pnl_usd, alpha_decay_score, avg_leverage, trade_count_30d, most_traded_asset'
        )
        .order(sortBy, { ascending: false })
        .limit(limit)

      if (input.archetype) query = query.eq('archetype', input.archetype)
      if (input.min_pnl != null) query = query.gte('total_pnl_usd', input.min_pnl)
      if (input.min_win_rate != null) query = query.gte('win_rate', input.min_win_rate)
      if (input.min_sharpe != null) query = query.gte('sharpe_30d', input.min_sharpe)
      if (input.max_leverage != null) query = query.lte('avg_leverage', input.max_leverage)
      if (input.min_trades != null) query = query.gte('trade_count_30d', input.min_trades)

      const { data, error } = await query
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify(data || [])
    }

    case 'get_wallet_state': {
      const state = await hlPost({
        type: 'clearinghouseState',
        user: input.address,
      })
      // Summarise positions for the agent
      const positions = (state?.assetPositions || [])
        .filter((p: { position: { szi: string } }) => parseFloat(p.position.szi) !== 0)
        .map((p: { position: { coin: string; szi: string; entryPx: string | null; leverage: { value: number }; unrealizedPnl: string; liquidationPx: string | null; positionValue: string; returnOnEquity: string } }) => ({
          asset: p.position.coin,
          size: p.position.szi,
          entryPrice: p.position.entryPx,
          leverage: p.position.leverage?.value,
          unrealizedPnl: p.position.unrealizedPnl,
          liquidationPrice: p.position.liquidationPx,
          positionValue: p.position.positionValue,
          roe: p.position.returnOnEquity,
        }))

      return JSON.stringify({
        accountValue: state?.marginSummary?.accountValue,
        totalMarginUsed: state?.marginSummary?.totalMarginUsed,
        withdrawable: state?.withdrawable,
        openPositions: positions,
      })
    }

    case 'get_wallet_pnl': {
      const portfolio = await hlPost({
        type: 'portfolio',
        user: input.address,
      })

      if (!Array.isArray(portfolio)) return JSON.stringify({ error: 'No portfolio data' })

      const summary: Record<string, unknown> = {}
      for (const [timeframe, data] of portfolio) {
        const hist = data?.pnlHistory
        if (Array.isArray(hist) && hist.length > 0) {
          const latest = parseFloat(hist[hist.length - 1][1])
          const earliest = parseFloat(hist[0][1])
          summary[timeframe] = {
            currentPnl: Math.round(latest * 100) / 100,
            startPnl: Math.round(earliest * 100) / 100,
            dataPoints: hist.length,
            startDate: new Date(hist[0][0]).toISOString().split('T')[0],
            endDate: new Date(hist[hist.length - 1][0]).toISOString().split('T')[0],
          }
        }
      }

      return JSON.stringify(summary)
    }

    case 'get_wallet_fills': {
      const days = Math.min(Math.max((input.days as number) || 7, 1), 90)
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000

      const fills = await hlPost({
        type: 'userFillsByTime',
        user: input.address,
        startTime,
      })

      if (!Array.isArray(fills)) return JSON.stringify({ error: 'No fills data' })

      // Compute summary stats
      let totalPnl = 0
      let wins = 0
      let losses = 0
      const assetVolume: Record<string, number> = {}

      for (const f of fills) {
        const pnl = parseFloat(f.closedPnl || '0')
        totalPnl += pnl
        if (pnl > 0) wins++
        else if (pnl < 0) losses++
        const vol = Math.abs(parseFloat(f.sz) * parseFloat(f.px))
        assetVolume[f.coin] = (assetVolume[f.coin] || 0) + vol
      }

      const topAssets = Object.entries(assetVolume)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([asset, volume]) => ({ asset, volume: Math.round(volume) }))

      // Return recent fills (last 20) plus summary
      const recentFills = fills.slice(-20).map((f: { coin: string; side: string; sz: string; px: string; closedPnl: string; time: number }) => ({
        asset: f.coin,
        side: f.side === 'B' ? 'buy' : 'sell',
        size: f.sz,
        price: f.px,
        pnl: f.closedPnl,
        time: new Date(f.time).toISOString(),
      }))

      return JSON.stringify({
        totalFills: fills.length,
        totalPnl: Math.round(totalPnl * 100) / 100,
        wins,
        losses,
        winRate: fills.length > 0 ? Math.round((wins / fills.length) * 1000) / 10 : 0,
        topAssets,
        recentFills,
        periodDays: days,
      })
    }

    case 'get_market_overview': {
      const data = await hlPost({ type: 'metaAndAssetCtxs' })
      const meta = Array.isArray(data) ? data[0] : data?.meta
      const ctxs = Array.isArray(data) ? data[1] : data?.assetCtxs
      const universe = meta?.universe || []
      const assetCtxs = Array.isArray(ctxs) ? ctxs : []

      let totalVolume = 0
      let openInterest = 0
      const movers: Array<{ name: string; change: number; price: number; volume: number }> = []

      assetCtxs.forEach((ctx: Record<string, string>, i: number) => {
        const vol = parseFloat(ctx.dayNtlVlm || '0')
        const markPx = parseFloat(ctx.markPx || '0')
        const oi = parseFloat(ctx.openInterest || '0') * markPx
        const prevPx = parseFloat(ctx.prevDayPx || '0')

        totalVolume += vol
        openInterest += oi

        if (prevPx > 0) {
          const change = Math.round(((markPx - prevPx) / prevPx) * 10000) / 100
          movers.push({ name: universe[i]?.name || `Asset ${i}`, change, price: markPx, volume: Math.round(vol) })
        }
      })

      movers.sort((a, b) => b.change - a.change)

      return JSON.stringify({
        totalVolume24h: Math.round(totalVolume),
        openInterest: Math.round(openInterest),
        totalAssets: universe.length,
        topGainers: movers.slice(0, 5),
        topLosers: movers.slice(-5).reverse(),
      })
    }

    case 'get_asset_info': {
      const assetName = (input.asset as string).toUpperCase()
      const data = await hlPost({ type: 'metaAndAssetCtxs' })
      const meta = Array.isArray(data) ? data[0] : data?.meta
      const ctxs = Array.isArray(data) ? data[1] : data?.assetCtxs
      const universe = meta?.universe || []
      const assetCtxs = Array.isArray(ctxs) ? ctxs : []

      const idx = universe.findIndex((u: { name: string }) => u.name.toUpperCase() === assetName)
      if (idx === -1) return JSON.stringify({ error: `Asset "${assetName}" not found on Hyperliquid` })

      const ctx = assetCtxs[idx]
      const markPx = parseFloat(ctx.markPx || '0')
      const prevPx = parseFloat(ctx.prevDayPx || '0')
      const change = prevPx > 0 ? Math.round(((markPx - prevPx) / prevPx) * 10000) / 100 : 0

      return JSON.stringify({
        asset: assetName,
        markPrice: markPx,
        change24h: change,
        volume24h: Math.round(parseFloat(ctx.dayNtlVlm || '0')),
        openInterest: Math.round(parseFloat(ctx.openInterest || '0') * markPx),
        fundingRate: ctx.funding,
        maxLeverage: universe[idx]?.maxLeverage,
      })
    }

    case 'scan_wallets_by_period': {
      const days = Math.min(Math.max((input.days as number) || 7, 1), 90)
      const minReturnPct = (input.min_return_pct as number) ?? null
      const minPnlUsd = (input.min_pnl_usd as number) ?? null
      const limit = Math.min(Math.max((input.limit as number) || 10, 1), 20)
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000

      // Fetch ALL tracked wallets from Supabase (paginate in case there are >1000)
      const allCandidates: Array<{ address: string; label: string | null; archetype: string | null }> = []
      const PAGE_SIZE = 1000
      let offset = 0
      while (true) {
        const { data: page, error: dbError } = await getSupabase()
          .from('wallets')
          .select('address, label, archetype')
          .range(offset, offset + PAGE_SIZE - 1)

        if (dbError) return JSON.stringify({ error: dbError.message })
        if (!page || page.length === 0) break
        allCandidates.push(...page)
        if (page.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      if (allCandidates.length === 0) return JSON.stringify({ error: 'No wallets in database' })

      // Process wallets in batches to avoid overwhelming the Hyperliquid API
      const BATCH_SIZE = 15
      interface PeriodResult {
        address: string; label: string | null; archetype: string | null
        periodDays: number; periodPnl: number; returnPct: number
        currentAccountValue: number; tradeCount: number; winRate: number
      }
      const allResults: PeriodResult[] = []

      for (let b = 0; b < allCandidates.length; b += BATCH_SIZE) {
        const batch = allCandidates.slice(b, b + BATCH_SIZE)

        const batchResults = await Promise.allSettled(
          batch.map(async (wallet) => {
            const [fills, state] = await Promise.all([
              hlPost({ type: 'userFillsByTime', user: wallet.address, startTime }),
              hlPost({ type: 'clearinghouseState', user: wallet.address }),
            ])

            if (!Array.isArray(fills)) return null

            let periodPnl = 0
            let tradeCount = 0
            let wins = 0
            for (const f of fills) {
              const pnl = parseFloat(f.closedPnl || '0')
              periodPnl += pnl
              tradeCount++
              if (pnl > 0) wins++
            }

            if (tradeCount === 0) return null

            const accountValue = parseFloat(state?.marginSummary?.accountValue || '0')
            const startingValue = accountValue - periodPnl
            const returnPct = startingValue > 0
              ? Math.round((periodPnl / startingValue) * 10000) / 100
              : periodPnl > 0 ? Infinity : 0

            return {
              address: wallet.address,
              label: wallet.label,
              archetype: wallet.archetype,
              periodDays: days,
              periodPnl: Math.round(periodPnl * 100) / 100,
              returnPct,
              currentAccountValue: Math.round(accountValue * 100) / 100,
              tradeCount,
              winRate: tradeCount > 0 ? Math.round((wins / tradeCount) * 1000) / 10 : 0,
            }
          })
        )

        for (const r of batchResults) {
          if (r.status === 'fulfilled' && r.value != null) {
            allResults.push(r.value)
          }
        }
      }

      let wallets = allResults
      if (minReturnPct != null) wallets = wallets.filter((w) => w.returnPct >= minReturnPct)
      if (minPnlUsd != null) wallets = wallets.filter((w) => w.periodPnl >= minPnlUsd)

      // Sort by return percentage descending
      wallets.sort((a, b) => b.returnPct - a.returnPct)
      wallets = wallets.slice(0, limit)

      return JSON.stringify({
        period: `${days} days`,
        matchCount: wallets.length,
        totalWalletsScanned: allCandidates.length,
        wallets,
      })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ── Main agent loop ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are AlphaLens AI, an expert trading analyst assistant built into the AlphaLens platform — a Hyperliquid perpetuals DEX intelligence tool.

Your capabilities:
- Search tracked wallets by PnL, Sharpe ratio, win rate, archetype, leverage, and trade count
- Scan wallets to find top performers over ANY custom time period (e.g. last 3 days, last 2 weeks) — use scan_wallets_by_period for this
- Look up any wallet's live positions, account value, and unrealised PnL
- Retrieve historical PnL and trade fills for specific wallets
- Get real-time market data: volume, open interest, top movers, asset prices
- Compute metrics like ROI, win rate, and PnL over custom timeframes

Important: When users ask about profits/returns over a specific number of days (e.g. "100% in 3 days", "best performers this week"), use scan_wallets_by_period — it computes exact returns from live trade data.

Wallet archetypes you know: market_maker, momentum_trader, basis_trader, whale, scalper, swing_trader. Wallets with insufficient evidence are 'unclassified'.

Equity tiers (matching the Smart Money page): Leviathan (>=$5M), Whale (>=$500K), Shark (>=$100K), Fish (>=$10K), Crab (>=$1K), Shrimp (<$1K).

When answering:
- Use the tools to get real data. Never make up wallet addresses or numbers.
- Present results in clear, structured format with the most important metrics highlighted.
- For wallet addresses, ALWAYS output the full address (e.g. 0x1234567890abcdef1234567890abcdef12345678). Never truncate addresses — the UI will handle display formatting.
- Format currency values with $ prefix and appropriate notation ($1.2M, $45K, $3,200).
- If the user asks for something the tools can't provide, explain what's available and suggest the closest alternative.
- Be concise but thorough. Lead with the answer, then provide supporting details.`

const MODELS: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
}

export async function POST(req: Request) {
  try {
    const { query, model: requestedModel } = await req.json()

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured. Add it to your environment variables.' },
        { status: 500 }
      )
    }

    const modelKey = (typeof requestedModel === 'string' && MODELS[requestedModel]) ? requestedModel : 'haiku'
    const modelId = MODELS[modelKey]

    const client = new Anthropic({ apiKey })

    // Run the agentic loop
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: query.trim() },
    ]

    const toolCallLog: Array<{ tool: string; input: Record<string, unknown>; summary: string }> = []

    // Allow up to 10 tool-call rounds
    for (let i = 0; i < 10; i++) {
      const response = await client.messages.create({
        model: modelId,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      })

      // If the model is done (no more tool calls), extract the text
      if (response.stop_reason === 'end_turn') {
        const textBlocks = response.content.filter(
          (b): b is Anthropic.TextBlock => b.type === 'text'
        )
        const answer = textBlocks.map((b) => b.text).join('\n')
        return NextResponse.json({ answer, toolCalls: toolCallLog, model: modelKey })
      }

      // Process tool calls
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      )

      if (toolUseBlocks.length === 0) {
        // No tool calls and not end_turn — extract whatever text there is
        const textBlocks = response.content.filter(
          (b): b is Anthropic.TextBlock => b.type === 'text'
        )
        const answer = textBlocks.map((b) => b.text).join('\n')
        return NextResponse.json({ answer, toolCalls: toolCallLog, model: modelKey })
      }

      // Add the assistant response to messages
      messages.push({ role: 'assistant', content: response.content })

      // Execute all tool calls and build results
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const toolUse of toolUseBlocks) {
        try {
          const result = await executeTool(
            toolUse.name,
            toolUse.input as Record<string, unknown>
          )

          // Log for the frontend
          const parsed = JSON.parse(result)
          const summary = Array.isArray(parsed)
            ? `Found ${parsed.length} results`
            : parsed.error
              ? `Error: ${parsed.error}`
              : `Retrieved data`
          toolCallLog.push({
            tool: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            summary,
          })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result,
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Tool execution failed'
          toolCallLog.push({
            tool: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            summary: `Error: ${errorMsg}`,
          })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: errorMsg }),
            is_error: true,
          })
        }
      }

      messages.push({ role: 'user', content: toolResults })
    }

    return NextResponse.json({
      answer: 'I ran out of steps processing your request. Please try a more specific query.',
      toolCalls: toolCallLog,
    })
  } catch (err) {
    console.error('Agent API error:', err)
    const message = err instanceof Error ? err.message : 'Agent request failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
