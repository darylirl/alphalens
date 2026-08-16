#!/usr/bin/env node
/**
 * AlphaLens verification worker (Prompt C).
 *
 * Polls verification_jobs, runs one job at a time, writes an immutable
 * verification_results row, and heartbeats into capture_health with
 * service='verify' so the app can tell a down worker from an idle one.
 *
 * Claiming goes through the claim_verification_job() RPC, which does
 * SELECT ... FOR UPDATE SKIP LOCKED internally: PostgREST cannot express row
 * locking, and without SKIP LOCKED two workers would race for the same job.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY),
 *      POLL_MS (default 5000), VERIFY_BUCKET (default verification-results),
 *      TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (optional).
 *
 * Run: node index.mjs   (Node >= 22; zero npm dependencies)
 */

import { hostname } from 'node:os'
import { assertConfigured, sb, rpc, heartbeat } from './lib/db.mjs'
import { runJob } from './lib/runner.mjs'
import { ENGINE_VERSION } from './lib/engine.mjs'

const POLL_MS = parseInt(process.env.POLL_MS || '5000', 10)
const HEARTBEAT_MS = 60_000

const WORKER_ID =
  process.env.RAILWAY_REPLICA_ID ||
  process.env.RAILWAY_SERVICE_ID ||
  process.env.FLY_MACHINE_ID ||
  hostname()

const log = (...a) => console.log(new Date().toISOString(), ...a)

const state = {
  currentJob: null,
  phase: 'starting',
  jobsDone: 0,
  jobsFailed: 0,
  lastError: null,
}

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) { log('ALERT (telegram unconfigured):', text); return }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `[alphalens-verify] ${text}` }),
    })
  } catch (e) { log('telegram send failed:', e.message) }
}

async function beat() {
  try {
    await heartbeat({
      note: `worker=${WORKER_ID} engine=${ENGINE_VERSION} phase=${state.phase}`
        + `${state.currentJob ? ` job=${state.currentJob}` : ''}`
        + ` done=${state.jobsDone} failed=${state.jobsFailed}`,
    })
  } catch (e) { log('heartbeat failed:', e.message) }
}

async function finishJob(id, fields) {
  await sb(`verification_jobs?id=eq.${id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { finished_at: new Date().toISOString(), ...fields },
  })
}

/** Claim and run one job. Returns true when a job was processed. */
export async function tick() {
  const claimed = await rpc('claim_verification_job', { p_worker: WORKER_ID })
  const job = Array.isArray(claimed) ? claimed[0] : claimed
  if (!job) return false

  state.currentJob = job.id
  state.phase = 'running'
  log(`claimed job ${job.id} (spec_hash ${String(job.spec_hash).slice(0, 12)}…)`)
  const t0 = Date.now()

  try {
    const { metrics, verdict } = await runJob(job, { log })
    await finishJob(job.id, { status: 'done', error: null })
    state.jobsDone += 1
    log(`job ${job.id} done in ${((Date.now() - t0) / 1000).toFixed(1)}s: `
      + `${metrics.trade_count} trades, net $${metrics.net_pnl_usd}, verdict ${verdict.overall}`)
  } catch (e) {
    state.jobsFailed += 1
    state.lastError = e.message
    // The error text is the deliverable when a job fails: a spec that cannot
    // be verified must say why, in the row the requester will read.
    const message = e.errors ? e.errors.join('; ') : (e.stack || e.message)
    log(`job ${job.id} FAILED: ${message}`)
    await finishJob(job.id, { status: 'failed', error: message.slice(0, 8000) })
      .catch((err) => log(`could not mark job ${job.id} failed:`, err.message))
    await telegram(`job ${job.id} failed: ${e.message}`.slice(0, 500))
  } finally {
    state.currentJob = null
    state.phase = 'idle'
  }
  return true
}

async function main() {
  assertConfigured()
  log(`verification worker starting: id=${WORKER_ID} engine=${ENGINE_VERSION} poll=${POLL_MS}ms`)
  state.phase = 'idle'
  setInterval(beat, HEARTBEAT_MS)
  beat()

  for (;;) {
    let ran = false
    try {
      ran = await tick()
    } catch (e) {
      // Claim/transport failures must not kill the worker; the queue is durable.
      log('poll failed:', e.message)
    }
    if (!ran) await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

process.on('unhandledRejection', (e) => log('unhandledRejection:', e?.message || e))

if (import.meta.url === `file://${process.argv[1]}`) main()
