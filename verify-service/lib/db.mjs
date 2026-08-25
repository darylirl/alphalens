/**
 * Supabase access for the verification service.
 *
 * Every read here is explicitly bounded or paged. PostgREST silently truncates
 * at ~1000 rows — see CLAUDE.md; that behaviour has already cost this project
 * two production bugs, so `sb()` is never called with an unbounded select.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''

export const RESULTS_BUCKET = process.env.VERIFY_BUCKET || 'verification-results'
export const PAGE_SIZE = 1000

export function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required')
  }
}

const MAX_RETRIES = parseInt(process.env.VERIFY_DB_RETRIES || '5', 10)

/**
 * A statement timeout or a 5xx is a transient condition, not a verdict about
 * the strategy: the capture daemon and the cohort backfill share this
 * database's IO, and a replay that reads it for minutes will meet both. Those
 * are retried with backoff. A 4xx is a real error — a bad filter, a missing
 * grant, a constraint rejection — and is raised immediately.
 */
const isTransient = (status, text) =>
  status >= 500 || status === 408 || status === 429 || text.includes('57014')

export async function sb(path, { method = 'GET', body, prefer, headers: extra } = {}) {
  assertConfigured()
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  }
  if (prefer) headers.Prefer = prefer

  let delay = 1000
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      if (attempt >= MAX_RETRIES) throw new Error(`supabase ${method} ${path.split('?')[0]}: ${e.message}`)
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
      continue
    }

    if (res.ok) {
      const text = await res.text()
      return text ? JSON.parse(text) : null
    }

    const text = await res.text().catch(() => '')
    if (attempt < MAX_RETRIES && isTransient(res.status, text)) {
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
      continue
    }
    throw new Error(`supabase ${method} ${path.split('?')[0]}: ${res.status} ${text.slice(0, 300)}`)
  }
}

/**
 * Page a PostgREST select until a short page comes back. `pathQs` must already
 * contain its filters and an `order` — an unordered page walk returns an
 * arbitrary slice, not a stable sequence.
 */
export async function pageAll(pathQs, { pageSize = PAGE_SIZE, maxRows = 500_000 } = {}) {
  if (!/[?&]order=/.test(pathQs)) {
    throw new Error(`pageAll requires an explicit order= for a stable page walk: ${pathQs}`)
  }
  const out = []
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await sb(`${pathQs}&limit=${pageSize}&offset=${offset}`)
    if (!page || page.length === 0) break
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

export async function rpc(fn, args) {
  return sb(`rpc/${fn}`, { method: 'POST', body: args })
}

/**
 * Page an RPC that takes p_limit/p_offset. Same contract as pageAll: the
 * function must return rows in a stable order.
 */
export async function rpcPageAll(fn, args, { pageSize = PAGE_SIZE, maxRows = 500_000 } = {}) {
  const out = []
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await rpc(fn, { ...args, p_limit: pageSize, p_offset: offset })
    if (!page || page.length === 0) break
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

/** Upload (or overwrite) an object in Supabase Storage. Returns the object path. */
export async function uploadObject(bucket, objectPath, body, contentType = 'text/csv') {
  assertConfigured()
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': contentType,
    'x-upsert': 'true',
  }
  let delay = 1000
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(url, { method: 'POST', headers, body })
    } catch (e) {
      if (attempt >= MAX_RETRIES) throw new Error(`storage upload ${objectPath}: ${e.message}`)
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
      continue
    }
    if (res.ok) return `${bucket}/${objectPath}`
    const text = await res.text().catch(() => '')
    if (attempt < MAX_RETRIES && isTransient(res.status, text)) {
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
      continue
    }
    throw new Error(`storage upload ${objectPath}: ${res.status} ${text.slice(0, 300)}`)
  }
}

/**
 * Heartbeat into the shared capture_health table. Defaults to the worker's
 * service='verify'; callers pass their own service label to stay
 * distinguishable (the scorer beats as service='scorer').
 */
export async function heartbeat(row) {
  return sb('capture_health', {
    method: 'POST',
    body: [{ service: 'verify', ...row }],
    prefer: 'return=minimal',
  })
}
