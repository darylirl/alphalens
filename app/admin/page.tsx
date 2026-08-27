import type { Metadata } from 'next'
import { loadPublishStatus } from '@/lib/admin/publish-status'
import { loadCommittedSpecs } from '@/lib/admin/specs'
import { getAdminToken } from '@/lib/auth/admin'
import { AdminConsole } from './AdminConsole'

// Unlisted by construction: noindex/nofollow here, Disallow in robots.txt, and
// absent from app/sitemap.ts and from both nav components. The gate is the
// admin token — this only keeps the page out of indexes and menus.
export const metadata: Metadata = {
  title: 'Admin console — AlphaLens',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const [publishStatus, committedSpecs] = await Promise.all([
    loadPublishStatus(),
    loadCommittedSpecs(),
  ])

  return (
    <AdminConsole
      publishStatus={publishStatus}
      committedSpecs={committedSpecs}
      // Whether a token is configured at all, not the token: an open-mode
      // deployment should say so rather than show a login that does nothing.
      authConfigured={getAdminToken() !== null}
    />
  )
}
