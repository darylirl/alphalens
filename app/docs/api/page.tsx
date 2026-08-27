import type { Metadata } from 'next'
import Link from 'next/link'
import { BottomNav } from '@/components/layout/BottomNav'

// Static API documentation. No database reads: every example below is a real
// response captured from the live endpoints on 2026-08-25, trimmed for length
// where noted — not invented data.

export const metadata: Metadata = {
  title: 'API docs — AlphaLens',
  description:
    'The AlphaLens public read API: Ledger calls, cohort positioning, and capture health as JSON. v0, read-only, no auth.',
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-sm font-bold text-[#F0FAF8] mt-8 mb-2 scroll-mt-20">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-white/70 leading-relaxed mb-3">{children}</p>
}

function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 overflow-x-auto">
      <span className="text-[10px] font-mono font-bold text-[#34EAB9] border border-[#34EAB9]/50 rounded px-1.5 py-0.5 shrink-0">
        {method}
      </span>
      <code className="text-xs font-mono text-white/85 whitespace-nowrap">{path}</code>
    </div>
  )
}

function Params({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="mb-3 border border-white/[0.08] rounded-lg divide-y divide-white/[0.06]">
      {rows.map(([name, desc]) => (
        <div key={name} className="px-3 py-2 text-[11px] leading-relaxed">
          <code className="font-mono text-[#34EAB9]">{name}</code>
          <span className="text-white/60"> — {desc}</span>
        </div>
      ))}
    </div>
  )
}

function Example({ caption, children }: { caption: string; children: string }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] text-white/40 mb-1">{caption}</p>
      <pre className="text-[10px] leading-relaxed font-mono text-white/70 bg-[#0A1417] border border-white/[0.08] rounded-lg p-3 overflow-x-auto">
        {children}
      </pre>
    </div>
  )
}

const LEDGER_LIST_EXAMPLE = `{
  "schema": "ledger.v0",
  "calls": [
    {
      "id": 5,
      "permalink": "https://alphalens-taupe.vercel.app/ledger/5",
      "published_at": "2026-08-25T14:18:53.747945+00:00",
      "kind": "hypothesis_verdict",
      "subject": {
        "coins": ["BTC"],
        "scope": "strategy",
        "verdict": "killed",
        "strategy": "spec_replay",
        "spec_version": 1
      },
      "claim": "KILLED: \\"When the tracked cohort's 24h net flow in BTC flips from net-short to net-long, BTC continues higher over the following day, by enough to clear 60s-delayed taker execution.\\" — replayed over 2026-06-17 to 2026-08-16 under floor-or-worse frictions (60s delay, 5bps slippage, 0.045% taker/side): 35 trades, net $-66.55.",
      "confidence": null,
      "provenance": {
        "engine": "verify-engine@1.0.0",
        "job_id": 3,
        "result_id": 2,
        "spec_hash": "1843951c2fedf3ba670aa46c03458446c7f19eea6c8705d1228aacf6e989d248"
      },
      "horizon_hours": 1440,
      "resolves_at": null,
      "resolved_at": null,
      "outcome": null,
      "scored_brier": null,
      "resolution_evidence": null
    }
  ],
  "next_cursor": null
}`

const LEDGER_DETAIL_EXAMPLE = `{
  "schema": "ledger.v0",
  "call": {
    "id": 5,
    "permalink": "https://alphalens-taupe.vercel.app/ledger/5",
    "published_at": "2026-08-25T14:18:53.747945+00:00",
    "kind": "hypothesis_verdict",
    "claim": "KILLED: \\"When the tracked cohort's 24h net flow in BTC flips from net-short to net-long, ...\\"",
    "confidence": null,
    "horizon_hours": 1440,
    "outcome": null,
    "scored_brier": null
  }
}`

const PULSE_EXAMPLE = `{
  "coins": [
    {
      "coin": "BTC",
      "notionalUsd": 1536099886,
      "netFlowUsd": 27489171,
      "longPct": 51,
      "longPctChange": 1,
      "notionalChangePct": 141,
      "newLongs": 1437,
      "newShorts": 1571,
      "newNotionalUsd": 22538000,
      "addNotionalUsd": 638143478,
      "activeWallets": 257
    }
  ],
  "coverage": {
    "live": true,
    "captureSince": "2026-08-16T06:10:07.262732+00:00",
    "lastHeartbeat": "2026-08-25T15:25:39.379093+00:00",
    "walletsTracked": 176,
    "computedAt": "2026-08-25T15:05:02.11+00:00"
  }
}`

const HEALTH_EXAMPLE = `{
  "live": true,
  "lastHeartbeat": "2026-08-25T15:25:39.379093+00:00",
  "captureSince": "2026-08-16T06:10:07.262732+00:00",
  "wsConnected": true,
  "walletsTracked": 176,
  "walletsWs": 176,
  "coinsTracked": 150
}`

export default function ApiDocsPage() {
  return (
    <div className="pb-24 md:pb-8">
      <div className="px-4 py-4 lg:px-6 max-w-2xl mx-auto">
        <h1 className="text-lg font-bold mb-1">Public read API</h1>
        <P>
          Nine read-only JSON endpoints expose what AlphaLens publishes: the
          Ledger (our public, append-only track record), the cohort positioning
          behind Pulse, the tracked cohort itself, the live health of the
          capture pipeline, and the per-wallet report card and replay data.
          They exist so machines — scripts, dashboards, AI agents — can read
          the record without scraping HTML.
        </P>
        <P>
          Agents that speak MCP can skip the HTTP layer: the{' '}
          <a
            href="https://github.com/darylirl/alphalens/tree/HEAD/mcp-service"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#34EAB9] hover:underline"
          >
            AlphaLens MCP server
          </a>{' '}
          wraps these same endpoints as four read-only tools. It is a client of
          this API like any other — it holds no database credentials and has no
          privileged read path.
        </P>

        <div className="border border-[#F5A623]/30 bg-[#F5A623]/5 rounded-lg p-3 mb-2">
          <p className="text-[11px] text-white/70 leading-relaxed">
            <span className="font-bold text-[#F5A623]">Stability:</span> this is
            v0 and read-only. Response shapes may gain fields but existing
            fields will not be renamed or removed. No authentication. No rate
            limits are enforced yet — be polite: cache on your side and keep
            request rates modest. Data reflects captured coverage honestly;
            missing data is served as <code className="font-mono">null</code>,
            never as zero. Nothing served here is financial advice.
          </p>
        </div>

        <H2 id="ledger-calls">List Ledger calls</H2>
        <Endpoint method="GET" path="/api/ledger/calls" />
        <P>
          Every published call, newest first. Calls are append-only by database
          enforcement: a wrong call is never edited or deleted, so this list is
          a track record, not a highlight reel. See the{' '}
          <Link href="/ledger/methodology" className="text-[#34EAB9] hover:underline">Ledger methodology</Link>{' '}
          for what may be published and how calls are scored.
        </P>
        <Params rows={[
          ['kind', 'restrict to one call kind: hypothesis_verdict (the adjudicated result of a completed replay) or cohort_signal (a forward-looking call that gets scored). Omit for both. Any other value is a 400 — never a silently empty page. The response echoes the applied filter as a top-level kind, null when unfiltered; the example below was captured before that field existed.'],
          ['limit', 'calls per page, integer. Default 50, maximum 200.'],
          ['cursor', 'opaque pagination cursor from a previous response’s next_cursor (a base64 string). Omit for the first page; next_cursor is null when there is no further page.'],
        ]} />
        <Example caption="Real response captured 2026-08-25 (calls array trimmed to one entry):">
          {LEDGER_LIST_EXAMPLE}
        </Example>

        <H2 id="ledger-call">One Ledger call</H2>
        <Endpoint method="GET" path="/api/ledger/calls/{id}" />
        <P>
          A single call by numeric id — the JSON twin of its permalink page.
          Returns 404 with a JSON error body if the id does not exist. A{' '}
          <code className="font-mono">cohort_signal</code> call gains its
          resolution block (<code className="font-mono">resolved_at</code>,{' '}
          <code className="font-mono">outcome</code>,{' '}
          <code className="font-mono">scored_brier</code>,{' '}
          <code className="font-mono">resolution_evidence</code>) exactly once,
          when the scorer resolves it against captured tape; a data gap at
          either instant resolves as{' '}
          <code className="font-mono">unresolvable</code> with no Brier score.
        </P>
        <Example caption="Real response captured 2026-08-25 (fields abridged for length — the live response carries the full call shape shown above):">
          {LEDGER_DETAIL_EXAMPLE}
        </Example>

        <H2 id="pulse">Cohort positioning (Pulse)</H2>
        <Endpoint method="GET" path="/api/pulse" />
        <P>
          Rolling 24-hour positioning of the tracked cohort, aggregated
          entirely from captured Hyperliquid fills — long/short skew, net flow,
          and traded notional per coin, plus a coverage block stating when
          capture started, its last heartbeat, and whether it is currently
          live. No parameters. Change fields are{' '}
          <code className="font-mono">null</code> when there is no prior-window
          baseline to compare against.
        </P>
        <Example caption="Real response captured 2026-08-25 (coins array trimmed to one of 40 entries):">
          {PULSE_EXAMPLE}
        </Example>

        <H2 id="cohort">The tracked cohort</H2>
        <Endpoint method="GET" path="/api/cohort" />
        <P>
          The wallets AlphaLens captures — the API twin of{' '}
          <Link href="/cohort" className="text-[#34EAB9] hover:underline">/cohort</Link>.
          Returns <code className="font-mono">count</code> and{' '}
          <code className="font-mono">by_archetype</code> for the whole cohort,
          the <code className="font-mono">selection</code> criteria that put a
          wallet in capture scope, a{' '}
          <code className="font-mono">snapshot</code> block with the CSV
          download URL and the SHA-256 of exactly those bytes, and one bounded
          page of <code className="font-mono">wallets</code>. Counts describe
          the entire cohort (the endpoint pages through the table rather than
          trusting one read); the wallet array is a page of it.
        </P>
        <P>
          This list exists so our claims can be audited, not so the wallets can
          be followed — we replayed 28,318 trades from wallets like these under
          honest frictions and lost money. A failed database read is a 503, not
          an empty list: &ldquo;we could not measure&rdquo; and &ldquo;nobody is
          in scope&rdquo; are opposite claims.
        </P>
        <Params rows={[
          ['limit', 'wallets per page, integer. Default 100, maximum 500.'],
          ['cursor', 'the address from a previous response’s next_cursor. Wallets are ordered by address, so the cursor is a plain address rather than an opaque token — a resumed page is checkable against the CSV. A cursor that is not in the current cohort is a 400.'],
        ]} />
        <p className="text-[11px] text-white/40 leading-relaxed mb-3">
          No example response is shown here yet. Every example on this page is a
          real captured response and this endpoint ships with the change that
          added this section — an invented sample would be exactly the kind of
          thing the rest of this project exists to avoid.
        </p>

        <H2 id="capture-health">Capture health</H2>
        <Endpoint method="GET" path="/api/capture/health" />
        <P>
          Live status of the forward-capture daemon, from its per-minute
          heartbeats. When the daemon is down this says so —{' '}
          <code className="font-mono">live</code> is false once heartbeats are
          more than 3 minutes silent. Check this before trusting the recency of
          anything else. No parameters.
        </P>
        <Example caption="Real response captured 2026-08-25:">
          {HEALTH_EXAMPLE}
        </Example>

        <H2 id="card">Wallet report card</H2>
        <Endpoint method="GET" path="/api/card/{address}" />
        <P>
          The JSON twin of{' '}
          <Link href="/card/0x0000000000000000000000000000000000000000" className="text-[#34EAB9] hover:underline">/card/&#123;address&#125;</Link>{' '}
          for any valid address. All-time PnL is the exchange&rsquo;s own{' '}
          <code className="font-mono">allTime</code> portfolio figure (never
          window arithmetic); win rate, profit factor, hold time, sizing
          consistency and risk figures are computed from real fills — our
          capture store for cohort wallets, the exchange&rsquo;s recent window
          (~10K most recent fills, labelled as such) for everyone else. No
          dimension is graded below 30 resolved round trips:{' '}
          <code className="font-mono">grades.gradeable</code> is false and the
          grade fields are <code className="font-mono">null</code>. The win
          rate is served raw and with empirical-Bayes shrinkage toward the
          cohort mean, alongside the prior so the adjustment is auditable.
          Every response carries a <code className="font-mono">coverage</code>{' '}
          block naming the fills source and window.
        </P>
        <p className="text-[11px] text-white/40 leading-relaxed mb-3">
          No example response is shown here yet — every example on this page is
          a real captured response, and this endpoint ships with the change
          that added this section.
        </p>

        <H2 id="replay">Replay coins, docs, metadata, fills, and candles</H2>
        <Endpoint method="GET" path="/api/replay/{address}/coins" />
        <Endpoint method="GET" path="/api/replay/{address}/doc?coin=&range=&interval=" />
        <Endpoint method="GET" path="/api/replay/{address}" />
        <Endpoint method="GET" path="/api/replay/{address}/fills?coin=" />
        <Endpoint method="GET" path="/api/replay/candles?coin=&interval=&from=&to=" />
        <P>
          The coins endpoint is the replay page&rsquo;s first paint: per-coin
          fill counts, spans and realized-PnL sums over the covered window
          (one SQL aggregate for cohort wallets, one exchange-window read for
          pasted ones — no episode detection, no document building), with a
          coverage block naming the source. The doc endpoint is what the
          player consumes: one precomputed replay document per (wallet, coin,
          range, bar width) — coarsened candles, trade events, running
          position and realized-PnL series, and the coin&rsquo;s episode index
          — cached in <code className="font-mono">replay_docs</code> and
          served as a single row. Fills travel columnar and losslessly packed
          (<code className="font-mono">replay-doc.v2</code>): times as deltas,
          prices, sizes and realized PnL as fixed-point integers scaled by the
          document&rsquo;s own exponents, side folded into the direction index.
          Every value decodes back to the exact original — the encoder
          verifies it and ships the column unscaled if it cannot. Documents
          cached in the older <code className="font-mono">replay-doc.v1</code>
          row-per-fill shape are still served and still decode. A first, uncached request builds the
          document and streams NDJSON: real progress lines, then a partial
          head document (the opening window, marked{' '}
          <code className="font-mono">partial</code>, so playback can start),
          then the full document; later requests return plain JSON.{' '}
          <code className="font-mono">range</code> is{' '}
          <code className="font-mono">default</code>,{' '}
          <code className="font-mono">all</code>, or{' '}
          <code className="font-mono">ep:&#123;fromMs&#125;-&#123;toMs&#125;</code>;{' '}
          <code className="font-mono">interval</code> is{' '}
          <code className="font-mono">auto</code> or a ladder interval.
        </P>
        <P>
          The data behind{' '}
          <Link href="/replay/0x0000000000000000000000000000000000000000" className="text-[#34EAB9] hover:underline">/replay/&#123;address&#125;</Link>.
          The metadata endpoint lists the coins a wallet traded in its covered
          window with per-coin fill counts and spans; the fills endpoint serves
          one coin&rsquo;s fills at exchange-exact execution prices (price,
          size, side, direction, realized PnL and fee exactly as the exchange
          reported them); the candles endpoint serves bars from the exchange
          retention ladder (~4,900 bars per interval: 1m, 5m, 15m, 1h, 4h, 1d)
          or, for the 1m rung beyond the exchange&rsquo;s ~3.5-day window, from
          our captured tape.
        </P>
        <Params rows={[
          ['coin', 'the coin symbol, e.g. BTC. Required on the fills and candles endpoints.'],
          ['interval', 'one of 1m, 5m, 15m, 1h, 4h, 1d. An interval that cannot honestly serve the window is a 400 carrying the reason — bars are never resampled or interpolated. The response’s intervals array reports availability and reasons for the exact window requested.'],
          ['from, to', 'window bounds as epoch milliseconds. Windows over 2,500 bars at the chosen interval are refused with a 400 naming the cap.'],
        ]} />
        <P>
          Candle responses declare their coverage: bars served versus bars the
          window could hold, internal gap count and the largest gap. Missing
          bars stay missing — a gap in the tape is drawn as a gap, never
          bridged or zero-filled.
        </P>
        <p className="text-[11px] text-white/40 leading-relaxed mb-3">
          No example responses are shown here yet — every example on this page
          is a real captured response, and these endpoints ship with the change
          that added this section.
        </p>

        <H2 id="conventions">Conventions</H2>
        <P>
          Ledger responses carry a top-level{' '}
          <code className="font-mono">schema: &quot;ledger.v0&quot;</code>{' '}
          version marker, the cohort endpoint carries{' '}
          <code className="font-mono">schema: &quot;cohort.v0&quot;</code>, the
          report card carries{' '}
          <code className="font-mono">schema: &quot;card.v0&quot;</code>, and
          the replay endpoints carry{' '}
          <code className="font-mono">schema: &quot;replay.v0&quot;</code>. Timestamps are ISO-8601 with timezone offsets.
          Responses are uncached (<code className="font-mono">Cache-Control:
          no-store</code>) and the Ledger endpoints allow cross-origin GET from
          any origin. Errors are JSON with an{' '}
          <code className="font-mono">error</code> string and an appropriate
          status code (400 bad input, 404 not found, 503 database unavailable).
        </P>

        <p className="text-[10px] text-white/30 pt-4 pb-2">
          Also machine-readable:{' '}
          <a href="/llms.txt" className="underline hover:text-[#34EAB9]">/llms.txt</a>{' '}
          describes the product for AI agents, and{' '}
          <a href="/sitemap.xml" className="underline hover:text-[#34EAB9]">/sitemap.xml</a>{' '}
          lists every public page including call permalinks.
        </p>
      </div>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
