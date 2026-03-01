'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check } from 'lucide-react'
import { truncateAddress } from '@/lib/walletAliases'

interface CopyableAddressProps {
  address: string
  /** Show as a clickable link to /wallet/[address]. Default true. */
  linked?: boolean
  /** Additional CSS classes on the wrapper */
  className?: string
  /** Use monospace font. Default true. */
  mono?: boolean
  /** Color variant. 'accent' = green (default), 'white' = white text with underline. */
  variant?: 'accent' | 'white'
}

export function CopyableAddress({ address, linked = true, className = '', mono = true, variant = 'accent' }: CopyableAddressProps) {
  const [copied, setCopied] = useState(false)

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const display = truncateAddress(address)
  const fontClass = mono ? 'font-mono' : ''
  const textClass = variant === 'white'
    ? `text-[#F0FAF8] underline decoration-white/30 hover:decoration-white/70 ${fontClass} text-xs`
    : `text-[#34EAB9] ${fontClass} text-xs hover:underline`

  const inner = (
    <span className={`inline-flex items-center gap-1.5 group ${className}`}>
      {linked ? (
        <Link
          href={`/wallet/${address}`}
          className={textClass}
          title={address}
        >
          {display}
        </Link>
      ) : (
        <span className={textClass} title={address}>
          {display}
        </span>
      )}
      <button
        onClick={copy}
        className="text-white/25 hover:text-white/70 transition-colors shrink-0"
        title="Copy full address"
      >
        {copied ? <Check size={12} className="text-[#34EAB9]" /> : <Copy size={12} />}
      </button>
    </span>
  )

  return inner
}
