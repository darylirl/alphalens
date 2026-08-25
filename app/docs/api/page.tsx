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
          Four read-only JSON endpoints expose what AlphaLens publishes: the
          Ledger (our public, append-only track record), the cohort positioning
          behind Pulse, and the live health of the capture pipeline. They exist
          so machines — scripts, dashboards, AI agents — can read the record
          without scraping HTML.
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

        <H2 id="conventions">Conventions</H2>
        <P>
          Ledger responses carry a top-level{' '}
          <code className="font-mono">schema: &quot;ledger.v0&quot;</code>{' '}
          version marker. Timestamps are ISO-8601 with timezone offsets.
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
