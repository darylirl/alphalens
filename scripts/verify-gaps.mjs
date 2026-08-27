#!/usr/bin/env node
/**
 * Fixture checks for the gap detector and the gap-aware episode splitter.
 *
 * The app has no test runner (verify-service does; the Next app does not), and
 * a detector that decides what counts as missing measurement should not ship
 * unexercised. This compiles the two modules with the repo's own tsc and
 * asserts against fixtures taken from real measured data — the numbers in the
 * comments are the fixture wallet's, not invented shapes.
 *
 *   node scripts/verify-gaps.mjs
 *
 * Exits non-zero on the first failed assertion.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const out = mkdtempSync(join(tmpdir(), 'alphalens-gaps-'))
try {
  const cfg = join(out, 'tsconfig.json')
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
  writeFileSync(
    cfg,
    JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        target: 'es2022',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        // The two modules import only TYPES across the alias boundary; the
        // mapping matters to tsc and to nothing at runtime.
        baseUrl: root,
        paths: { '@/*': ['./*'] },
        outDir: join(out, 'js'),
      },
      files: [join(root, 'lib/wallet-data/gaps.ts'), join(root, 'lib/replay/episodes.ts')],
    })
  )
  execFileSync('npx', ['tsc', '-p', cfg], { stdio: 'inherit' })

  const { coinGaps, walletGaps, drawable, coveredMs } = await import(
    join(out, 'js/wallet-data/gaps.js')
  )
  const { detectEpisodes } = await import(join(out, 'js/replay/episodes.js'))

  const HOUR = 3_600_000
  const DAY = 24 * HOUR
  const t0 = Date.parse('2026-04-19T15:38:12.140Z')
  const fill = (t, coin, side, sz, start, pnl = 0) => ({
    coin,
    time: t,
    side,
    sz: String(sz),
    px: '2500',
    startPosition: String(start),
    closedPnl: String(pnl),
    fee: '0',
    dir: side === 'B' ? 'Open Long' : 'Close Long',
    hash: '',
    oid: 0,
    crossed: false,
    tid: t,
  })

  let checks = 0
  const check = (name, fn) => {
    fn()
    checks++
    console.log(`  ok  ${name}`)
  }

  // 1. A same-millisecond burst with interleaved start positions is NOT a gap.
  //    Measured on the fixture wallet: nine ETH fills at 12:11:35.132 with
  //    start positions running 10200 → 10234 in tid order. Differencing per
  //    fill called 206,433 of 212,000 boundaries a break; per burst, none.
  check('same-ms burst with interleaved start positions is not a gap', () => {
    const burst = [
      fill(t0, 'ETH', 'B', 18.1817, 10210.8816),
      fill(t0, 'ETH', 'B', 0.8984, 10204.2432),
      fill(t0, 'ETH', 'B', 5.0954, 10229.0633),
      fill(t0, 'ETH', 'B', 3.2895, 10200.9537),
      fill(t0, 'ETH', 'B', 2.9397, 10205.1416),
      fill(t0, 'ETH', 'B', 0.7917, 10208.0813),
      fill(t0, 'ETH', 'B', 15.8413, 10234.1587),
      fill(t0, 'ETH', 'B', 2.0086, 10208.873),
      fill(t0, 'ETH', 'B', 0.9537, 10200),
      // Next burst two hours later, starting exactly where the first ended
      // (10200 + 50.0 = 10250): a long quiet stretch with NO position break.
      fill(t0 + 2 * HOUR, 'ETH', 'B', 1, 10250),
    ]
    assert.equal(coinGaps('ETH', burst).length, 0)
  })

  // 2. The fixture's first gap: 41.6 days, position 10,561.35 → 1,150.00.
  check('a position break across a long stretch is a proven gap', () => {
    const a = t0
    const b = t0 + 41.57 * DAY
    const fills = [fill(a, 'ETH', 'B', 10.352, 10551), fill(b, 'ETH', 'A', 150, 1150)]
    const gaps = coinGaps('ETH', fills)
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0].kind, 'position_break')
    assert.equal(gaps[0].from, a)
    assert.equal(gaps[0].to, b)
    assert.ok(Math.abs(gaps[0].unexplained_coins - -9411.352) < 0.01)
  })

  // 3. Silence with the position intact is NOT a gap. This is the whole point:
  //    a wallet is allowed to stop trading, and drawing that as missing data
  //    is the same lie as reading a missing bucket as zero.
  check('a quiet stretch with no position break is never a drawable gap', () => {
    const a = t0
    const b = t0 + 30 * DAY
    const fills = [fill(a, 'ETH', 'B', 10, 100), fill(b, 'ETH', 'A', 5, 110)]
    assert.equal(coinGaps('ETH', fills).length, 0)
    const wallet = walletGaps(fills)
    assert.equal(wallet.length, 1)
    assert.equal(wallet[0].kind, 'quiet')
    assert.equal(drawable(wallet).length, 0)
    // Quiet time is measured time: it must not be subtracted from coverage.
    assert.equal(coveredMs(a, b, wallet), b - a)
  })

  // 4. A sub-hour discrepancy is below the floor — burst-ordering noise, not
  //    a coverage hole.
  check('a sub-hour position discrepancy is not reported', () => {
    const fills = [
      fill(t0, 'ETH', 'B', 10, 100),
      fill(t0 + 13_000, 'ETH', 'A', 5, 8000),
    ]
    assert.equal(coinGaps('ETH', fills).length, 0)
  })

  // 5. Another coin's break does not make a wallet-level stretch "uncovered":
  //    the fixture's HYPE break spans stretches in which ETH was captured
  //    normally, and those stretches are quiet, not missing.
  check('a coin break does not prove a wallet stretch it merely contains', () => {
    const fills = [
      fill(t0, 'HYPE', 'B', 100, 1000),
      fill(t0 + 1 * DAY, 'ETH', 'B', 1, 0),
      fill(t0 + 3 * DAY, 'ETH', 'A', 1, 1),
      fill(t0 + 10 * DAY, 'HYPE', 'A', 50, 5000), // HYPE break spans the lot
    ]
    const wallet = walletGaps(fills)
    // The ETH-bounded stretches are quiet; nothing is drawable, because no
    // coin's break is bounded exactly by one of them.
    assert.equal(drawable(wallet).length, 0)
    assert.ok(wallet.every(g => g.kind === 'quiet'))
  })

  // 6. Episodes: without gaps a position open on both sides reads as ONE round
  //    trip; with the gap it is two observed positions.
  check('an episode never spans a proven gap', () => {
    const a = t0
    const b = t0 + 41.57 * DAY
    const rfills = [
      { t: a, px: 2500, sz: 10, side: 'B', dir: 'Open Long', pnl: 0, fee: 0, start: 0 },
      { t: a + HOUR, px: 2500, sz: 5, side: 'B', dir: 'Open Long', pnl: 0, fee: 0, start: 10 },
      { t: b, px: 2500, sz: 2, side: 'A', dir: 'Close Long', pnl: 100, fee: 0, start: 3 },
      { t: b + HOUR, px: 2500, sz: 1, side: 'A', dir: 'Close Long', pnl: 50, fee: 0, start: 1 },
    ]
    const before = detectEpisodes(rfills)
    assert.equal(before.length, 1, 'ungapped detection merges the two positions')
    assert.equal(before[0].from, a)
    assert.equal(before[0].to, b + HOUR)

    const after = detectEpisodes(rfills, [{ from: a + HOUR, to: b }])
    assert.equal(after.length, 2)
    assert.equal(after[0].to, a + HOUR)
    assert.equal(after[0].endsAtGap, true)
    assert.equal(after[0].openAtEnd, true, 'we never saw this position close')
    assert.equal(after[1].from, b)
    assert.equal(after[1].startsAfterGap, true)
    // And the PnL no longer pools across unmeasured time.
    assert.equal(after[0].pnl, 0)
    assert.equal(after[1].pnl, 150)
  })

  // 7. Two segments either side of a gap are never merged by the flat-gap
  //    merge rule, whatever the clock says.
  check('the merge rule does not reach across a gap', () => {
    const a = t0
    const rfills = [
      { t: a, px: 1, sz: 1, side: 'B', dir: 'Open Long', pnl: 0, fee: 0, start: 0 },
      { t: a + 1000, px: 1, sz: 1, side: 'A', dir: 'Close Long', pnl: 5, fee: 0, start: 1 },
      { t: a + 2000, px: 1, sz: 1, side: 'B', dir: 'Open Long', pnl: 0, fee: 0, start: 0 },
      { t: a + 3000, px: 1, sz: 1, side: 'A', dir: 'Close Long', pnl: 7, fee: 0, start: 1 },
    ]
    assert.equal(detectEpisodes(rfills).length, 1, 'merged without a gap')
    const split = detectEpisodes(rfills, [{ from: a + 1000, to: a + 2000 }])
    assert.equal(split.length, 2)
    assert.equal(split[1].startsAfterGap, true)
  })

  console.log(`\n${checks} checks passed`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
