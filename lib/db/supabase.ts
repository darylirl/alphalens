import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const supabaseUrl = process.env.SUPABASE_URL || ''
    // Prefer the service-role key so server-side writes work with RLS
    // enabled; the anon key falls back to read-only under RLS. This module
    // must only be imported from server code — never 'use client' files.
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
    // Next patches global fetch with a framework Data Cache that has served
    // stale database reads even under `dynamic = 'force-dynamic'` (observed
    // on /pulse: heartbeats rendered ~1h stale while real rows were seconds
    // old). Database state must never come from a render cache — force
    // no-store at the client so every caller inherits it.
    _supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' }),
      },
    })
  }
  return _supabase
}
