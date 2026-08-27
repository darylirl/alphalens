/**
 * One-shot local pre-builder for the Famous Replays manifest (scratch tool,
 * not wired into any deploy): runs the SAME buildReplayDoc the doc route
 * runs, for every manifest entry, and writes each resulting replay_docs row
 * (route-identical hashes and fields) as JSON to --out. Used to warm the
 * production cache when no deployment with the service-role key has built
 * the entries yet; the row is then inserted by the operator. Reads only —
 * this script never writes to the database.
 */
import { createHash } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { listFamousReplays } from '@/lib/replay/famous'
import { buildReplayDoc } from '@/lib/replay/doc-build'
import { parseRangeKey } from '@/lib/replay/docspec'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

async function main() {
  const outDir = process.argv[2]
  const only = process.argv[3] // optional slug filter
  if (!outDir) {
    console.error('usage: tsx scripts/prebuild-famous-local.mts <outDir> [slug]')
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })
  for (const e of listFamousReplays()) {
    if (only && e.slug !== only) continue
    const range = parseRangeKey(e.range)
    if (!range || typeof range !== 'object') {
      console.error(`${e.slug}: manifest range is not an explicit episode — skipping`)
      continue
    }
    console.log(`building ${e.slug} (${e.coin} ${e.range})…`)
    const t0 = Date.now()
    const built = await buildReplayDoc(
      e.address,
      { coin: e.coin, range, interval: e.interval },
      p => process.stdout.write(`  ${p.phase} ${JSON.stringify(p.detail)}\n`),
      undefined, // no head doc: this warms the cache, there is no playhead
      undefined, // wallet row unknown here; the builder reads it
      { window: { fromMs: range.from, toMs: range.to }, forceSource: e.fills_source }
    )
    const paramsHash = sha256(`${e.coin}|${e.range}|${e.interval}`)
    const contentHash = sha256(
      `${e.address}|${e.coin}|${e.range}|${e.interval}|${built.lastFillId ?? 'none'}`
    )
    const docJson = JSON.stringify(built.doc)
    const row = {
      content_hash: contentHash,
      wallet_address: e.address,
      coin_key: e.coin,
      params_hash: paramsHash,
      params: { coin: e.coin, range: e.range, interval: e.interval },
      source: built.source,
      last_fill_id: built.lastFillId,
      built_through: built.builtThrough,
      fill_count: built.fillCount,
      doc_bytes: docJson.length,
      build_ms: built.buildMs,
      built_at: new Date().toISOString(),
      // Curated entries are pinned: no TTL, whatever the source. The doc
      // route serves a pinned row regardless of expiry, so a stored expiry
      // would only mislead the next thing that reads the table.
      expires_at: null,
    }
    writeFileSync(join(outDir, `${e.slug}.row.json`), JSON.stringify(row, null, 2))
    writeFileSync(join(outDir, `${e.slug}.doc.json`), docJson)
    const d = built.doc
    const pnl = d.fills.reduce((s, f) => s + f[5], 0)
    console.log(
      `  ✓ ${e.slug}: ${Date.now() - t0}ms, source=${built.source}, fills=${d.fills.length}, ` +
        `resolved=${d.resolved?.range} @${d.resolved?.interval}, doc=${(docJson.length / 1024).toFixed(0)}KB, ` +
        `sum closedPnl=${pnl.toFixed(2)} (manifest ${e.pnl_usd})`
    )
  }
}

void main().catch(err => {
  console.error(err)
  process.exit(1)
})
