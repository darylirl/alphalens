'use client'
import { useCallback, useEffect, useState } from 'react'
import { Lock, LogOut, ShieldAlert } from 'lucide-react'
import type { PublishStatus } from '@/lib/admin/publish-status'
import type { CommittedSpecs } from '@/lib/admin/specs'
import { EnqueuePanel } from './EnqueuePanel'
import { JobsPanel } from './JobsPanel'
import { WalletsPanel } from './WalletsPanel'
import { PublishPanel } from './PublishPanel'
import { SignalPanel } from './SignalPanel'

const TABS = [
  { id: 'enqueue', label: 'Enqueue verification' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'publish', label: 'Ledger publishing' },
  { id: 'signal', label: 'Publish signal' },
] as const

type TabId = (typeof TABS)[number]['id']

export function AdminConsole({
  publishStatus,
  committedSpecs,
  authConfigured,
}: {
  publishStatus: PublishStatus
  committedSpecs: CommittedSpecs
  authConfigured: boolean
}) {
  const [tab, setTab] = useState<TabId>('enqueue')

  // Auth state. `authorized` is what the server said about THIS request, so the
  // console shows the panels only when the cookie would actually be accepted.
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/unlock', { cache: 'no-store' })
      const data = await res.json()
      setAuthorized(Boolean(data.authorized))
    } catch {
      setAuthorized(false)
      setAuthError('Could not reach the auth endpoint.')
    }
  }, [])

  useEffect(() => { refreshAuth() }, [refreshAuth])

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setAuthError(null)
    try {
      const res = await fetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.ok) {
        setToken('')
        await refreshAuth()
      } else {
        const data = await res.json().catch(() => null)
        setAuthError(data?.error || `Sign-in failed (HTTP ${res.status}).`)
      }
    } catch {
      setAuthError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    try {
      await fetch('/api/auth/unlock', { method: 'DELETE' })
      await refreshAuth()
    } catch {
      setAuthError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 py-4 lg:px-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold mb-0.5">Admin console</h1>
          <p className="text-white/55 text-xs max-w-2xl">
            Privileged actions, in the browser. Every button here is an ordinary API call the
            service already exposes — this page adds no capability that a terminal did not
            already have, it just removes the terminal.
          </p>
        </div>
        {authorized && authConfigured && (
          <button
            onClick={signOut}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/55 hover:text-white/80 transition-colors disabled:opacity-40"
          >
            <LogOut size={12} /> Sign out
          </button>
        )}
      </header>

      {!authConfigured && (
        <div className="card p-3 border-l-2 border-l-amber-400 flex items-start gap-2">
          <ShieldAlert size={12} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-400">
            <span className="font-semibold">ADMIN_API_TOKEN is not set on this deployment.</span>{' '}
            The mutating APIs are running in open mode, so everything below acts without
            authentication. That is the intended local/dev behaviour; set the variable before
            exposing this host.
          </p>
        </div>
      )}

      {authorized === null ? (
        <div className="card p-6 text-center text-xs text-white/40">Checking admin session…</div>
      ) : !authorized ? (
        <div className="card p-4 border-l-2 border-l-amber-400 max-w-lg">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={12} className="text-amber-400 shrink-0" />
            <p className="text-xs font-semibold text-amber-400">Admin token required</p>
          </div>
          <p className="text-[11px] text-white/45 mb-3">
            The token is stored in an httpOnly session cookie for 8 hours — the browser sends it,
            no script can read it, and nothing is written to this repo. Paste it here rather than
            into a chat or a shell.
          </p>
          <form onSubmit={signIn} className="flex gap-2">
            <input
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Admin token"
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs font-mono text-[#F0FAF8] placeholder:text-white/25 focus:outline-none focus:border-amber-400/40"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 transition-colors disabled:opacity-50"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {authError && <p className="text-[10px] text-[#FF3B5C] mt-1.5">{authError}</p>}
        </div>
      ) : (
        <>
          <nav className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors ${
                  tab === t.id ? 'bg-[#34EAB9] text-[#0F1A1E]' : 'bg-[#0F1A1E] text-white/55 hover:text-white/80'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {authError && <p className="text-[10px] text-[#FF3B5C]">{authError}</p>}

          {tab === 'enqueue' && <EnqueuePanel committedSpecs={committedSpecs} />}
          {tab === 'jobs' && <JobsPanel publishStatus={publishStatus} />}
          {tab === 'wallets' && <WalletsPanel />}
          {tab === 'publish' && <PublishPanel publishStatus={publishStatus} />}
          {tab === 'signal' && <SignalPanel />}
        </>
      )}
    </div>
  )
}
