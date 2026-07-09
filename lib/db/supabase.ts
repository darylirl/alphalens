import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const supabaseUrl = process.env.SUPABASE_URL || ''
    // Prefer the service-role key so server-side writes work with RLS
    // enabled; the anon key falls back to read-only under RLS. This module
    // must only be imported from server code — never 'use client' files.
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
    _supabase = createClient(supabaseUrl, supabaseKey)
  }
  return _supabase
}
