import { NextResponse } from 'next/server'
import type { LedgerCall } from '@/lib/ledger/calls'

// Public JSON surface of the Ledger, versioned as ledger.v0. Fields may be
// added over time but existing ones are never renamed or removed — machines
// read this. Serialization only: the write path stays the tested publishing
// rule and the scoring worker, enforced by the database.

export const LEDGER_SCHEMA = 'ledger.v0'

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://alphalens-taupe.vercel.app'

// The Ledger is a public track record; any origin may read it.
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
}

// Every public read response leads with a versioned schema marker so a
// machine reading it can tell which contract it is holding. ledger.v0 is the
// Ledger's; sibling surfaces (cohort.v0) use the same envelope and headers.
export function schemaJson(schema: string, body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ schema, ...body }, { status, headers: CORS_HEADERS })
}

export function ledgerJson(body: Record<string, unknown>, status = 200) {
  return schemaJson(LEDGER_SCHEMA, body, status)
}

// PostgREST serializes Postgres numeric columns as strings; the public API
// serves them as JSON numbers. NULL stays null — never coerced to 0.
const toNum = (v: number | string | null) => (v === null || v === undefined ? null : Number(v))

export function serializeCall(call: LedgerCall) {
  return {
    id: call.id,
    permalink: `${APP_URL}/ledger/${call.id}`,
    published_at: call.published_at,
    kind: call.kind,
    subject: call.subject,
    claim: call.claim,
    confidence: toNum(call.confidence),
    provenance: call.provenance,
    horizon_hours: toNum(call.horizon_hours),
    resolves_at: call.resolves_at,
    resolved_at: call.resolved_at,
    outcome: call.outcome,
    scored_brier: toNum(call.scored_brier),
    resolution_evidence: call.resolution_evidence,
  }
}

// Keyset cursor over (published_at desc, id desc) — stable under appends,
// no OFFSET scans. Opaque to clients: base64url of the last row's position.
export function encodeCursor(call: LedgerCall): string {
  return Buffer.from(JSON.stringify({ p: call.published_at, i: call.id }), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): { publishedAt: string; id: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (typeof parsed?.p !== 'string' || !Number.isInteger(parsed?.i)) return null
    if (Number.isNaN(Date.parse(parsed.p))) return null
    return { publishedAt: parsed.p, id: parsed.i }
  } catch {
    return null
  }
}
