/**
 * Strategy spec schema + rule grammar v1, plus the canonical spec hash.
 *
 * The grammar itself lives in ./grammar.mjs, which has no platform imports and
 * so can be bundled into the browser (the /admin console validates a spec
 * against grammar v1 before submitting it). This module is the Node-side
 * entry point: same grammar, plus specHash, which needs node:crypto.
 *
 * Importers keep using this module — the export surface is unchanged.
 */

import { createHash } from 'node:crypto'
import { canonicalJson } from './grammar.mjs'

export * from './grammar.mjs'

export function specHash(spec) {
  return createHash('sha256').update(canonicalJson(spec)).digest('hex')
}
