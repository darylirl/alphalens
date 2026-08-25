import Link from 'next/link'

const footerLinks = [
  { href: '/ledger', label: 'Ledger' },
  { href: '/research', label: 'Research' },
  { href: '/cohort', label: 'Cohort' },
  { href: '/ledger/methodology', label: 'Methodology' },
  { href: '/docs/api', label: 'API docs' },
]

// Global site footer. pb clears the fixed mobile BottomNav on pages that
// render one; on desktop the bar is hidden so normal padding applies.
export function Footer() {
  return (
    <footer className="border-t border-white/[0.08] mt-8 pb-24 md:pb-8">
      <div className="max-w-5xl mx-auto px-6 pt-6 flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {footerLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-[11px] text-white/40 hover:text-[#34EAB9] transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>
        <p className="text-[10px] text-white/30 md:ml-auto">
          Built on Hyperliquid. Nothing here is financial advice.
        </p>
      </div>
    </footer>
  )
}
