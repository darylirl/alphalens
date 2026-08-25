#!/usr/bin/env node
/**
 * Enqueue a strategy spec from a file (operator/CLI path; the app enqueues
 * through POST /api/verify). Validates before writing — an invalid spec should
 * never reach the queue.
 *
 *   node enqueue.mjs specs/btc-cohort-flow-flip.json [requested_by]
 */

import { readFile } from 'node:fs/promises'
import { validateSpec, specHash, SpecError } from './lib/spec.mjs'
import { sb } from './lib/db.mjs'

const [file, requestedBy = 'cli'] = process.argv.slice(2)
if (!file) {
  console.error('usage: node enqueue.mjs <spec.json> [requested_by]')
  process.exit(1)
}

let spec
try {
  spec = validateSpec(JSON.parse(await readFile(file, 'utf8')))
} catch (e) {
  if (e instanceof SpecError) {
    console.error('spec rejected:')
    for (const err of e.errors) console.error(`  - ${err}`)
    process.exit(2)
  }
  throw e
}

const [job] = await sb('verification_jobs', {
  method: 'POST',
  prefer: 'return=representation',
  body: [{ spec, spec_hash: specHash(spec), requested_by: requestedBy }],
})

console.log(JSON.stringify({ job_id: job.id, spec_hash: job.spec_hash, status: job.status }, null, 2))
