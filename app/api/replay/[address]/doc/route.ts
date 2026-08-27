import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { validateAddress } from '@/lib/validation'
import { getSupabase } from '@/lib/db/supabase'
import { loadWalletRow } from '@/lib/wallet-data/fills'
import { INTERVAL_MS } from '@/lib/wallet-data/candles'
import { CORS_HEADERS } from '@/lib/ledger/api'
import {
  buildReplayDoc,
  DocRefusal,
  type BuildProgress,
  type DocRequest,
} from '@/lib/replay/doc-build'
import {
  parseRangeKey,
  rangeKey,
  REPLAY_DOC_SCHEMA,
  REFRESH_FILL_THRESHOLD,
  SERVE_STALE_MAX_FILLS,
  PASTED_TTL_MS,
  type ReplayDoc,
} from '@/lib/replay/docspec'
import { famousPin } from '@/lib/replay/famous'

// The precomputed replay document: build-once-serve-forever.
//
// First request for an uncached (wallet, coin, range, interval) builds the
// doc while streaming REAL progress (NDJSON lines with actual page/bar
// counts — never a spinner over silence), then a partial HEAD doc (the
// opening window, so playback starts while the tail loads — Replay v2.2),
// then the full doc, then the cache write's outcome. Every later request is
// a single-row cache read served as plain JSON.
//
// Freshness is honest and cheap: a viewer is served a cached cohort doc with
// its fill-lag DECLARED — x-replay-fills-behind says exactly how many fills
// (in the doc's scope) landed after the build, and the player shows it — up
// to SERVE_STALE_MAX_FILLS, past which the view rebuilds synchronously. The
// pre-builder (prebuild=1) refreshes far earlier, at REFRESH_FILL_THRESHOLD.
// Pasted (exchange-window) docs expire on a short TTL because the exchange's
// ~10K-fill window slides regardless of our capture stream.

export const dynamic = 'force-dynamic'
// Cold builds page a cohort wallet's full captured history; give them room.
export const maxDuration = 60

interface CacheRow {
  content_hash: string
  source: 'store' | 'exchange'
  last_fill_id: number | null
  built_through: string | null
  fill_count: number
  doc: ReplayDoc
  built_at: string
  expires_at: string | null
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** Newest captured fill in the doc's scope (whole wallet for the default
 *  doc, one coin otherwise). Through the wallet-indexed RPC (migration 019)
 *  — a raw parameterized asset filter can generic-plan onto the (asset,
 *  timestamp) index and time out on popular coins. */
async function newestStoreFill(
  address: string,
  coin: string
): Promise<{ tid: number; timestamp: string } | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('replay_wallet_newest_fill', {
    p_wallet: address.toLowerCase(),
    p_coin: coin,
  })
  if (error) throw error
  return (data?.[0] as { tid: number; timestamp: string } | undefined) ?? null
}

/** How many captured fills (in scope) landed after the doc's build. Same
 *  wallet-indexed RPC family; the count is small by construction — the
 *  pre-builder refreshes docs long before it grows. */
async function fillsBehind(address: string, coin: string, since: string): Promise<number> {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('replay_wallet_fill_count', {
    p_wallet: address.toLowerCase(),
    p_coin: coin,
    p_since: since,
  })
  if (error) throw error
  return Number(data ?? 0)
}

export async function GET(req: NextRequest, { params }: { params: { address: string } }) {
  const address = validateAddress(params.address)
  if (!address) {
    return NextResponse.json(
      { error: 'Invalid address: expected 0x followed by 40 hex characters' },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  const q = req.nextUrl.searchParams
  const coin = q.get('coin') ?? ''
  if (coin && !/^[A-Za-z0-9@:_.-]{1,32}$/.test(coin)) {
    return NextResponse.json({ error: 'Bad ?coin=' }, { status: 400, headers: CORS_HEADERS })
  }
  const range = parseRangeKey(q.get('range') ?? 'default')
  if (!range) {
    return NextResponse.json(
      { error: 'Bad ?range= — pass default, all, or ep:<fromMs>-<toMs>' },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  const interval = q.get('interval') ?? 'auto'
  if (interval !== 'auto' && !INTERVAL_MS[interval]) {
    return NextResponse.json(
      { error: `Bad ?interval= — pass auto or one of ${Object.keys(INTERVAL_MS).join(', ')}` },
      { status: 400, headers: CORS_HEADERS }
    )
  }
  const prebuild = q.get('prebuild') === '1'

  const addr = address.toLowerCase()
  const rangeStr = rangeKey(range)
  const paramsCanonical = { coin, range: rangeStr, interval }
  const paramsHash = sha256(`${coin}|${rangeStr}|${interval}`)

  try {
    // The wallet row and the cache row are independent lookups; serialising
    // them put two round trips in front of every cold view for nothing.
    const supabase = getSupabase()
    const [wallet, cacheRes] = await Promise.all([
      loadWalletRow(addr),
      supabase
        .from('replay_docs')
        .select('content_hash,source,last_fill_id,built_through,fill_count,doc,built_at,expires_at')
        .eq('wallet_address', addr)
        .eq('coin_key', coin)
        .eq('params_hash', paramsHash)
        .maybeSingle(),
    ])
    const isCohort = Boolean(wallet?.capture_enabled)
    if (cacheRes.error) throw cacheRes.error
    const cached = (cacheRes.data as CacheRow | null) ?? null

    // A curated famous replay is closed history: its fills are immutable
    // facts, so the cached doc is pinned — no TTL, no fill-lag staleness.
    // Rebuilding could only LOSE data once the exchange's sliding ~10K-fill
    // window moves past the episode; the doc that was honestly built from the
    // fills while they were still served is the record.
    const pin = famousPin(addr, coin, rangeStr, interval)
    const pinned = Boolean(pin)

    // A doc built under an older schema cannot carry the gap block, and a
    // gapless doc for a wallet WITH gaps draws a continuous story across
    // unmeasured time. Older schemas are a cache miss, not a served answer.
    const usable =
      cached && (cached.doc as { schema?: string } | null)?.schema === REPLAY_DOC_SCHEMA

    if (cached && usable) {
      let fresh = false
      let behind = 0
      if (pinned) {
        fresh = true
      } else if (isCohort && cached.source === 'store') {
        const newest = await newestStoreFill(addr, coin)
        if (!newest) {
          fresh = true // nothing captured at all — the empty doc stands
        } else if (
          cached.built_through &&
          Date.parse(newest.timestamp) <= Date.parse(cached.built_through)
        ) {
          fresh = true
        } else if (cached.built_through) {
          behind = await fillsBehind(addr, coin, cached.built_through)
          // Viewers get the cached doc with the lag declared; the pre-builder
          // rebuilds at the much lower refresh threshold to keep it small.
          fresh = behind < (prebuild ? REFRESH_FILL_THRESHOLD : SERVE_STALE_MAX_FILLS)
        }
        // A doc built before any fills existed (built_through null) goes
        // stale the moment a fill lands: fresh stays false.
      } else {
        // Pasted wallets (and a cohort wallet whose doc had to fall back to
        // the exchange during a store outage): TTL only.
        fresh = Boolean(cached.expires_at && Date.parse(cached.expires_at) > Date.now())
      }

      if (fresh) {
        if (prebuild) {
          return NextResponse.json(
            { cached: true, behind, built_at: cached.built_at },
            { headers: CORS_HEADERS }
          )
        }
        return NextResponse.json(cached.doc, {
          headers: {
            ...CORS_HEADERS,
            'x-replay-doc': 'cached',
            'x-replay-fills-behind': String(behind),
            etag: `"${cached.content_hash}"`,
          },
        })
      }
    }

    // Build path: stream real progress, then the doc. NDJSON so the client
    // can show what is actually happening — first view builds; cached after.
    const encoder = new TextEncoder()
    const docReq: DocRequest = { coin, range, interval }
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const line = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        try {
          line({
            phase: 'building',
            note: 'building this replay — first view does the work; later views serve the cached document',
          })
          // Curated famous episodes load fills around their known window
          // instead of walking the wallet's whole retained history — some
          // famous wallets hold 50K+ retained fills, and the episode is a
          // closed span whose boundaries the padded load detects identically.
          const buildOpts =
            pin && typeof range === 'object'
              ? {
                  window: { fromMs: range.from, toMs: range.to },
                  forceSource: pin.fills_source,
                }
              : {}
          const built = await buildReplayDoc(
            addr,
            docReq,
            (p: BuildProgress) => line({ phase: p.phase, ...p.detail }),
            // Progressive playback: the opening window streams as a partial
            // head doc so the player can roll while the tail loads. The
            // pre-builder only warms the cache — it has no playhead to feed.
            // A PINNED curated episode streams a head too (it is only a
            // playback aid); what gets cached below is always built.doc, the
            // full document — a head is never stored.
            prebuild ? undefined : head => line({ phase: 'head', doc: head }),
            wallet,
            buildOpts
          )
          const contentHash = sha256(
            `${addr}|${coin}|${rangeStr}|${interval}|${built.lastFillId ?? 'none'}`
          )
          const docJson = JSON.stringify(built.doc)
          const row = {
            content_hash: contentHash,
            wallet_address: addr,
            coin_key: coin,
            params_hash: paramsHash,
            params: paramsCanonical,
            source: built.source,
            last_fill_id: built.lastFillId,
            built_through: built.builtThrough,
            fill_count: built.fillCount,
            doc: built.doc,
            doc_bytes: docJson.length,
            build_ms: built.buildMs,
            built_at: new Date().toISOString(),
            expires_at:
              built.source === 'exchange'
                ? new Date(Date.now() + PASTED_TTL_MS).toISOString()
                : null,
          }
          // A viewer gets the finished doc BEFORE the cache write — the
          // upsert of a multi-hundred-KB row has no business sitting between
          // a built replay and the person waiting on it. The write's outcome
          // still streams afterwards as its own line: the failure is declared
          // (cache_write), not just logged — a deployment missing the
          // service-role key would otherwise rebuild on every view and every
          // pre-build sweep, silently. The pre-builder keeps the old shape
          // (done last, carrying cache_write) so a mid-deploy worker never
          // misreads a build.
          if (!prebuild) {
            line({
              phase: 'done',
              build_ms: built.buildMs,
              cached: false,
              doc_bytes: docJson.length,
              doc: built.doc,
            })
          }
          // Replace semantics on the (wallet, coin, params) key; the write
          // failing must not fail the response — the doc was honestly built.
          const { error: upsertErr } = await supabase
            .from('replay_docs')
            .upsert(row, { onConflict: 'wallet_address,coin_key,params_hash' })
          if (upsertErr) console.error('replay_docs upsert failed:', upsertErr.message)
          line(
            prebuild
              ? {
                  phase: 'done',
                  build_ms: built.buildMs,
                  cached: false,
                  cache_write: upsertErr ? 'failed' : 'ok',
                  doc_bytes: docJson.length,
                }
              : { phase: 'stored', cache_write: upsertErr ? 'failed' : 'ok' }
          )
        } catch (err) {
          const refusal = err instanceof DocRefusal
          line({
            phase: 'error',
            refusal,
            error:
              err instanceof Error
                ? refusal
                  ? err.message
                  : 'Could not build this replay just now — the data sources did not answer'
                : 'could not build this replay',
          })
        } finally {
          controller.close()
        }
      },
    })
    return new NextResponse(stream, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'x-replay-doc': 'building',
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Could not load the replay document just now — the data sources did not answer' },
      { status: 503, headers: CORS_HEADERS }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
