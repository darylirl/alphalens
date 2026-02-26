import { NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import type { LedgerUpdate } from '@/lib/hyperliquid/types'

const HL_URL = 'https://api.hyperliquid.xyz/info'

const FILLS_PER_PAGE = 500
const MAX_FILL_PAGES = 20 // 10,000 fills hard cap from API
const LEDGER_PER_PAGE = 500
const MAX_LEDGER_PAGES = 200 // generous limit for ledger

async function hlPost(payload: Record<string, unknown>) {
  try {
    const res = await fetch(HL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function hlPostWithRetry(payload: Record<string, unknown>) {
  const result = await hlPost(payload)
  if (result !== null) return result
  // Retry once on failure
  return hlPost(payload)
}

async function fetchAllFills(address: string): Promise<{ fills: Array<Record<string, unknown>>; capped: boolean }> {
  const allFills: Array<Record<string, unknown>> = []
  let cursor = 0
  let capped = false

  for (let page = 0; page < MAX_FILL_PAGES; page++) {
    const data = await hlPostWithRetry({
      type: 'userFillsByTime',
      user: address,
      startTime: cursor,
      aggregateByTime: false,
    })
    if (!Array.isArray(data) || data.length === 0) break

    allFills.push(...data)

    // If fewer than a full page, we've reached the end
    if (data.length < FILLS_PER_PAGE) break

    // Paginate: use the last fill's timestamp + 1ms as next startTime
    const lastTime = (data[data.length - 1] as { time: number }).time
    if (lastTime <= cursor) break // no progress, avoid infinite loop
    cursor = lastTime + 1
  }

  // If we fetched exactly MAX_FILL_PAGES full pages, fills are likely capped at 10k
  if (allFills.length >= MAX_FILL_PAGES * FILLS_PER_PAGE) {
    capped = true
  }

  if (allFills.length > 0) return { fills: allFills, capped }

  // Fallback to legacy endpoint if new endpoint returned nothing
  const legacy = await hlPost({ type: 'userFills', user: address })
  if (Array.isArray(legacy)) return { fills: legacy, capped: false }
  return { fills: [], capped: false }
}

async function fetchAllLedgerUpdates(address: string): Promise<LedgerUpdate[]> {
  const allUpdates: LedgerUpdate[] = []
  let cursor = 0

  for (let page = 0; page < MAX_LEDGER_PAGES; page++) {
    const data = await hlPostWithRetry({
      type: 'userNonFundingLedgerUpdates',
      user: address,
      startTime: cursor,
    })
    if (!Array.isArray(data) || data.length === 0) break

    allUpdates.push(...(data as LedgerUpdate[]))

    if (data.length < LEDGER_PER_PAGE) break

    const lastTime = (data[data.length - 1] as { time: number }).time
    if (lastTime <= cursor) break
    cursor = lastTime + 1
  }

  return allUpdates
}

function computeTrueAllTimePnl(
  ledgerUpdates: LedgerUpdate[],
  accountValue: number
): { allTimePnl: number; totalDeposited: number; totalWithdrawn: number; accountValue: number } {
  let totalDeposited = 0
  let totalWithdrawn = 0

  for (const update of ledgerUpdates) {
    const amount = parseFloat(update.delta?.usdc || '0')
    const type = update.delta?.type
    if (type === 'deposit') {
      totalDeposited += amount
    } else if (type === 'withdraw') {
      totalWithdrawn += Math.abs(amount)
    }
  }

  const allTimePnl = accountValue + totalWithdrawn - totalDeposited

  return {
    allTimePnl: Math.round(allTimePnl * 100) / 100,
    totalDeposited: Math.round(totalDeposited * 100) / 100,
    totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
    accountValue: Math.round(accountValue * 100) / 100,
  }
}

export async function GET(req: Request, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json({ error: 'Invalid Ethereum address format' }, { status: 400 })
  }

  try {
    const [state, fillsResult, fundings, ledgerUpdates] = await Promise.all([
      hlPost({ type: 'clearinghouseState', user: address }),
      fetchAllFills(address),
      hlPost({ type: 'userFundings', user: address, startTime: 0 }).then(
        data => Array.isArray(data) ? data : []
      ),
      fetchAllLedgerUpdates(address),
    ])

    const defaultState = {
      assetPositions: [],
      crossMarginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' },
      marginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' },
      withdrawable: '0'
    }

    const resolvedState = state || defaultState
    const accountValue = parseFloat(resolvedState.marginSummary?.accountValue || '0')
    const allTimePnl = computeTrueAllTimePnl(ledgerUpdates, accountValue)

    // Sort fills ascending by time
    const sortedFills = fillsResult.fills.sort(
      (a, b) => (a as { time: number }).time - (b as { time: number }).time
    )

    return NextResponse.json({
      state: resolvedState,
      fills: sortedFills,
      fundings,
      address,
      allTimePnl,
      fillsCapped: fillsResult.capped,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch wallet data' }, { status: 502 })
  }
}
