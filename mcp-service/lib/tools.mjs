/**
 * The four read-only tools, v0.
 *
 * Each one wraps exactly one public HTTP endpoint and returns the standard
 * envelope (data / coverage / caveats / source / notice). No tool writes, no
 * tool touches the database, and no tool invents a value that the endpoint did
 * not serve — where the API says null, this says null.
 */

import { getJson, ApiError } from './api.mjs'
import { envelope } from './notice.mjs'

export const LEDGER_KINDS = ['hypothesis_verdict', 'cohort_signal']

// Capture is a live pipeline, so every read has to say how fresh it is. These
// two lines are appended wherever the answer depends on capture coverage.
const CAPTURE_CAVEAT =
  'All figures are computed from fills AlphaLens captured itself, not from an exchange-wide feed: ' +
  'a coin or wallet absent from a result was not observed trading, which is not the same claim as zero.'
const MARKET_MAKER_CAVEAT =
  'Market-maker wallets have been excluded from capture scope since 2026-08-25, so the flow below is ' +
  'directional-cohort flow and deliberately not a picture of total market volume.'

/* ------------------------------------------------------------------ pulse */

async function getPulse(_args, ctx) {
  const body = await getJson('api/pulse', {}, ctx)
  const coins = Array.isArray(body.coins) ? body.coins : []
  const cov = body.coverage ?? {}

  // /api/pulse degrades to an empty list with an all-null coverage block when
  // its database read fails. Empty-because-outage and empty-because-quiet are
  // opposite claims, so name which one this is instead of serving a bare [].
  const unmeasured = coins.length === 0 && cov.lastHeartbeat == null && cov.computedAt == null
  const stale = cov.live === false

  const caveats = [CAPTURE_CAVEAT, MARKET_MAKER_CAVEAT]
  if (unmeasured) {
    caveats.unshift(
      'NO MEASUREMENT AVAILABLE: the aggregate came back empty with no coverage metadata, which is the ' +
        'shape of a failed read rather than a quiet cohort. Do not read this as "the cohort is flat".'
    )
  } else if (stale) {
    caveats.unshift(
      'The capture daemon is not currently reporting (no heartbeat within 3 minutes), so the trailing edge ' +
        'of this 24h window may be incomplete. Values are as-of last_computed_at, not as-of now.'
    )
  }

  return envelope({
    data: {
      coins: coins.map(c => ({
        coin: c.coin,
        notional_usd: c.notionalUsd,
        net_flow_usd: c.netFlowUsd,
        long_pct: c.longPct,
        long_pct_change: c.longPctChange,
        notional_change_pct: c.notionalChangePct,
        new_longs: c.newLongs,
        new_shorts: c.newShorts,
        new_notional_usd: c.newNotionalUsd,
        add_notional_usd: c.addNotionalUsd,
        active_wallets: c.activeWallets,
      })),
      window: 'rolling 24h',
    },
    coverage: {
      status: unmeasured ? 'unavailable' : stale ? 'stale' : 'live',
      capture_live: cov.live ?? null,
      capture_since: cov.captureSince ?? null,
      last_heartbeat: cov.lastHeartbeat ?? null,
      wallets_tracked: cov.walletsTracked ?? null,
      last_computed_at: cov.computedAt ?? null,
      coins_returned: coins.length,
    },
    caveats: caveats.concat([
      'Change fields (long_pct_change, notional_change_pct) are null when there is no prior window to ' +
        'compare against — null means "no baseline", not "no change".',
      'The aggregate is refreshed on a schedule, so last_computed_at can trail the last heartbeat.',
    ]),
    source: `${ctx.base}/api/pulse`,
  })
}

/* ------------------------------------------------------------- ledger list */

async function listLedgerCalls(args, ctx) {
  const { kind, limit, cursor } = args

  if (kind !== undefined && !LEDGER_KINDS.includes(kind)) {
    throw new ApiError(`kind must be one of: ${LEDGER_KINDS.join(', ')}`, { hint: 'Omit kind to list every call.' })
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
    throw new ApiError('limit must be an integer between 1 and 200', { hint: 'Omit limit to use the API default of 50.' })
  }

  const body = await getJson('api/ledger/calls', { kind, limit, cursor }, ctx)
  const calls = Array.isArray(body.calls) ? body.calls : []

  // Belt and braces on the filter. If the deployment behind this base URL is
  // older than the kind parameter it will ignore it and return everything —
  // which would otherwise be served here as a filtered list. Drop the strays
  // and say so, rather than answering a question that was not asked.
  const filtered = kind ? calls.filter(c => c.kind === kind) : calls
  const serverHonoredFilter = filtered.length === calls.length

  const resolved = filtered.filter(c => c.resolved_at !== null).length
  const caveats = [
    'The Ledger is append-only by database enforcement: a wrong call is never edited or deleted. This is ' +
      'the whole track record, not a selection of the good ones.',
    'A null outcome means the call has not resolved yet. An outcome of "unresolvable" means captured tape ' +
      'had a gap at a decision instant and no price was guessed — it is scored with no Brier value.',
    'Pagination is keyset-based: pass next_cursor back as cursor for the following page. A null next_cursor ' +
      'means this was the last page.',
  ]
  if (kind && !serverHonoredFilter) {
    caveats.unshift(
      `The deployment at ${ctx.base} did not apply the kind filter server-side (it predates the parameter); ` +
        `${calls.length - filtered.length} non-matching call(s) were dropped here, so this page may be short ` +
        'even when more matching calls exist. Follow next_cursor to continue.'
    )
  }

  return envelope({
    data: {
      kind: kind ?? null,
      calls: filtered,
      next_cursor: body.next_cursor ?? null,
    },
    coverage: {
      calls_returned: filtered.length,
      resolved: resolved,
      unresolved: filtered.length - resolved,
      has_more: (body.next_cursor ?? null) !== null,
      schema: body.schema ?? null,
      server_side_kind_filter: kind ? serverHonoredFilter : null,
    },
    caveats,
    source: `${ctx.base}/api/ledger/calls`,
  })
}

/* ----------------------------------------------------------- ledger detail */

async function getLedgerCall(args, ctx) {
  const { id } = args
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError('id must be a positive integer', {
      hint: 'Call list_ledger_calls first and use an id from that response.',
    })
  }

  const body = await getJson(`api/ledger/calls/${id}`, {}, ctx)
  const call = body.call ?? null
  if (!call) {
    throw new ApiError(`call ${id} was not present in the response`, { hint: 'List calls and retry with a listed id.' })
  }

  const caveats = [
    'provenance identifies the engine, job and spec hash behind this call. A call published from the ' +
      'canonical engine can be re-run from its spec and is expected to reproduce byte-identically.',
  ]
  if (call.kind === 'hypothesis_verdict') {
    caveats.push(
      'A hypothesis_verdict is born final: it records the outcome of a completed replay under the friction ' +
        'floors (60s delay, 5bps slippage, 0.045% taker per side), so it has no pending resolution.'
    )
  }
  if (call.outcome === 'unresolvable') {
    caveats.push(
      'This call resolved as unresolvable: captured tape had a gap at a decision instant, so no price was ' +
        'assumed and no Brier score was assigned. That is an honest gap, not a miss.'
    )
  }
  if (call.kind === 'cohort_signal' && call.resolved_at === null) {
    caveats.push('This signal has not resolved yet — outcome and scored_brier are null because the horizon is still open.')
  }

  return envelope({
    data: { call },
    coverage: {
      resolved: call.resolved_at !== null,
      resolves_at: call.resolves_at ?? null,
      outcome: call.outcome ?? null,
      scored_brier: call.scored_brier ?? null,
      schema: body.schema ?? null,
    },
    caveats,
    source: `${ctx.base}/api/ledger/calls/${id}`,
  })
}

/* ----------------------------------------------------------------- cohort */

async function getCohort(args, ctx) {
  const { limit, cursor, include_wallets } = args
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) {
    throw new ApiError('limit must be an integer between 1 and 500', { hint: 'Omit limit to use the API default of 100.' })
  }

  // The summary is the point of this tool; the wallet page is opt-in so a
  // caller asking "how big is the cohort" does not get thousands of addresses.
  const wantWallets = include_wallets === true
  const body = await getJson('api/cohort', { limit: wantWallets ? limit : 1, cursor: wantWallets ? cursor : undefined }, ctx)

  return envelope({
    data: {
      count: body.count ?? null,
      by_archetype: body.by_archetype ?? [],
      selection: body.selection ?? null,
      snapshot: body.snapshot ?? null,
      wallets: wantWallets ? (body.wallets ?? []) : null,
      next_cursor: wantWallets ? (body.next_cursor ?? null) : null,
    },
    coverage: {
      count_is_full_cohort: true,
      wallets_included: wantWallets,
      wallets_returned: wantWallets ? (body.wallets ?? []).length : 0,
      has_more: wantWallets ? (body.next_cursor ?? null) !== null : null,
      schema: body.schema ?? null,
    },
    caveats: [
      'count and by_archetype describe the entire cohort (the endpoint pages through the table); wallets is ' +
        'one bounded page of it. Set include_wallets to list addresses, then follow next_cursor.',
      'snapshot.csv_sha256 is the SHA-256 of the CSV that snapshot.csv_url serves, generated from this same ' +
        'read. Download it and hash it to verify the list independently.',
      'This is a list of wallets AlphaLens captures so its claims can be audited. It is explicitly NOT a list ' +
        'of wallets to follow — replaying trades from wallets like these under honest frictions lost money.',
      'trade_count_30d is rate-normalized from each wallet\'s most recent classification sample, not a live ' +
        'counter, and is null when the wallet has never been sampled — never 0.',
      MARKET_MAKER_CAVEAT,
    ],
    source: `${ctx.base}/api/cohort`,
  })
}

/* ------------------------------------------------------------ definitions */

export const TOOLS = [
  {
    name: 'alphalens_get_pulse',
    title: 'Cohort positioning (Pulse)',
    description:
      'Current aggregate positioning of the AlphaLens-tracked wallet cohort, per coin, over a rolling 24 hours: ' +
      'traded notional, net flow, long/short skew, new positions and active wallet counts. Computed from fills ' +
      'AlphaLens captured itself. Returns the capture-coverage block alongside the numbers so freshness and ' +
      'completeness travel with them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getPulse,
  },
  {
    name: 'alphalens_list_ledger_calls',
    title: 'List Ledger calls',
    description:
      'Paginated list of published Ledger calls, newest first, with their outcomes. The Ledger is the ' +
      'append-only public track record: hypothesis verdicts (the adjudicated result of a frictioned replay) ' +
      'and cohort signals (forward-looking probabilistic calls, later scored against captured tape). Losing ' +
      'and unresolvable calls are included — they are never edited or removed.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: LEDGER_KINDS,
          description:
            'Restrict to one call kind. "hypothesis_verdict" is a completed replay verdict; "cohort_signal" is ' +
            'a forward-looking call that gets scored. Omit for both.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Calls per page. Defaults to 50 upstream.',
        },
        cursor: {
          type: 'string',
          description: 'Opaque cursor from a previous response\'s data.next_cursor. Omit for the first page.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: listLedgerCalls,
  },
  {
    name: 'alphalens_get_ledger_call',
    title: 'Get one Ledger call',
    description:
      'One Ledger call by numeric id, with its full provenance: the engine version, job and spec hash behind ' +
      'it, its claim, horizon, and (once resolved) its outcome, Brier score and resolution evidence. Use ' +
      'alphalens_list_ledger_calls to discover ids.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, description: 'Numeric Ledger call id, as returned by alphalens_list_ledger_calls.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getLedgerCall,
  },
  {
    name: 'alphalens_get_cohort',
    title: 'Tracked cohort summary',
    description:
      'The tracked wallet cohort: total count, a breakdown by behavioral archetype, the selection criteria ' +
      'that put a wallet in capture scope, and the URL plus SHA-256 of the downloadable CSV snapshot so the ' +
      'list can be audited independently. Optionally returns a paginated page of the addresses themselves.',
    inputSchema: {
      type: 'object',
      properties: {
        include_wallets: {
          type: 'boolean',
          description: 'Include a page of wallet addresses. Defaults to false — the summary alone is usually what is wanted.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'Wallets per page when include_wallets is true. Defaults to 100 upstream.',
        },
        cursor: {
          type: 'string',
          description: 'Address cursor from a previous response\'s data.next_cursor. Omit for the first page.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: getCohort,
  },
]

export const TOOLS_BY_NAME = new Map(TOOLS.map(t => [t.name, t]))

/** Tool definitions as the wire sees them — handlers are server-side only. */
export function toolDescriptors() {
  return TOOLS.map(({ handler, ...rest }) => rest)
}
