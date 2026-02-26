// Hyperliquid API Types

export interface Fill {
  coin: string
  px: string
  sz: string
  side: 'B' | 'A'
  time: number
  startPosition: string
  dir: string
  closedPnl: string
  hash: string
  oid: number
  crossed: boolean
  fee: string
  tid: number
}

export interface Position {
  coin: string
  entryPx: string | null
  leverage: {
    type: string
    value: number
  }
  liquidationPx: string | null
  marginUsed: string
  positionValue: string
  returnOnEquity: string
  szi: string
  unrealizedPnl: string
}

export interface AssetPosition {
  position: Position
  type: string
}

export interface ClearinghouseState {
  assetPositions: AssetPosition[]
  crossMarginSummary: {
    accountValue: string
    totalMarginUsed: string
    totalNtlPos: string
    totalRawUsd: string
  }
  marginSummary: {
    accountValue: string
    totalMarginUsed: string
    totalNtlPos: string
    totalRawUsd: string
  }
  withdrawable: string
}

export interface Funding {
  coin: string
  fundingRate: string
  premium: string
  time: number
}

export interface UserFunding {
  time: number
  coin: string
  usdc: string
  szi: string
  fundingRate: string
}

export interface OpenOrder {
  coin: string
  limitPx: string
  oid: number
  side: 'B' | 'A'
  sz: string
  timestamp: number
}

export interface AssetMeta {
  name: string
  szDecimals: number
  maxLeverage: number
  onlyIsolated: boolean
}

export interface AssetCtx {
  dayNtlVlm: string
  funding: string
  impactPxs: [string, string]
  markPx: string
  midPx: string
  openInterest: string
  oraclePx: string
  premium: string
  prevDayPx: string
}

export interface MetaAndAssetCtxs {
  meta: { universe: AssetMeta[] }
  assetCtxs: AssetCtx[]
}

export interface L2Book {
  coin: string
  levels: [Array<{ px: string; sz: string; n: number }>, Array<{ px: string; sz: string; n: number }>]
  time: number
}

export interface Candle {
  T: number
  c: string
  h: string
  l: string
  n: number
  o: string
  s: string
  t: number
  v: string
}

export interface LeaderboardEntry {
  ethAddress: string
  accountValue: string
  displayName: string | null
  prize: number
  windowPerformances: Array<{
    window: string
    pnl: string
    roi: string
  }>
}

export interface WalletAnalytics {
  address: string
  label?: string
  archetype: string
  archetypeConfidence: number
  sharpe7d: number
  sharpe30d: number
  sharpe90d: number
  alphaDecayScore: number
  winRate: number
  totalPnlUsd: number
  tradeCount30d: number
  avgHoldSeconds: number
  avgLeverage: number
  mostTradedAsset: string
}

// Portfolio API response: array of [timeframe_label, data] tuples
// Timeframe labels: "day", "week", "month", "allTime", "perpDay", "perpWeek", "perpMonth", "perpAllTime"
export type PortfolioEntry = [string, {
  pnlHistory: Array<[number, string]>
  accountValueHistory: Array<[number, string]>
}]

export interface WalletDetail {
  state: ClearinghouseState
  portfolio: PortfolioEntry[]
  fundings: UserFunding[]
  address: string
}
