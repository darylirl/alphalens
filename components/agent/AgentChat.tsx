'use client'
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User, Loader2, Sparkles, ChevronDown, ChevronUp, Zap, Brain } from 'lucide-react'
import { CopyableAddress } from '@/components/ui/CopyableAddress'

type ModelKey = 'haiku' | 'sonnet'

const MODEL_OPTIONS: { key: ModelKey; label: string; description: string; icon: typeof Zap }[] = [
  { key: 'haiku', label: 'Haiku', description: 'Fast & affordable', icon: Zap },
  { key: 'sonnet', label: 'Sonnet', description: 'Deeper analysis', icon: Brain },
]

interface ToolCall {
  tool: string
  input: Record<string, unknown>
  summary: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  model?: ModelKey
  timestamp: Date
}

const SUGGESTED_QUERIES = [
  'Find me 10 wallets that made over $100K profit',
  'Who are the top momentum traders by Sharpe ratio?',
  'What are the top 5 gainers right now?',
  'Show me scalpers with win rate above 60%',
  'Get the current positions of the top wallet',
  'What is the funding rate for ETH?',
  'Find low-leverage high-conviction traders',
  'Which wallets have the lowest alpha decay?',
]

const TOOL_LABELS: Record<string, string> = {
  search_wallets: 'Searching wallets',
  get_wallet_state: 'Fetching wallet state',
  get_wallet_pnl: 'Loading PnL history',
  get_wallet_fills: 'Retrieving trade fills',
  get_market_overview: 'Getting market data',
  get_asset_info: 'Looking up asset',
  scan_wallets_by_period: 'Scanning wallet returns',
}

export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [model, setModel] = useState<ModelKey>('haiku')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Close model menu on click outside
  useEffect(() => {
    if (!showModelMenu) return
    const handleClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showModelMenu])

  const sendQuery = async (query: string) => {
    if (!query.trim() || loading) return

    const userMessage: Message = {
      role: 'user',
      content: query.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setShowSuggestions(false)

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), model }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.error || 'Something went wrong. Please try again.',
            timestamp: new Date(),
          },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.answer,
            toolCalls: data.toolCalls,
            model: data.model,
            timestamp: new Date(),
          },
        ])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Network error — could not reach the agent. Please try again.',
          timestamp: new Date(),
        },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendQuery(input)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#34EAB9]/10 flex items-center justify-center mb-4">
              <Sparkles size={28} className="text-[#34EAB9]" />
            </div>
            <h2 className="text-lg font-bold mb-1">AlphaLens AI</h2>
            <p className="text-white/55 text-sm max-w-md mb-6">
              Ask me anything about Hyperliquid wallets, positions, market data, or trading patterns. I query live data to answer your questions.
            </p>

            {showSuggestions && (
              <div className="w-full max-w-2xl">
                <p className="text-white/40 text-xs mb-3 uppercase tracking-wider">Try asking</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SUGGESTED_QUERIES.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendQuery(q)}
                      className="text-left text-sm px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/70 hover:bg-white/[0.06] hover:text-white/90 hover:border-white/[0.12] transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-[#34EAB9]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={16} className="text-[#34EAB9]" />
                </div>
              )}

              <div
                className={`max-w-[85%] lg:max-w-[70%] ${
                  msg.role === 'user'
                    ? 'bg-[#34EAB9]/10 border border-[#34EAB9]/20 rounded-2xl rounded-br-md px-4 py-3'
                    : 'space-y-2'
                }`}
              >
                {/* Model badge + tool call badges for assistant messages */}
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mb-1">
                    {msg.model && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-white/30 font-mono">
                        {msg.model === 'haiku' ? <Zap size={9} /> : <Brain size={9} />}
                        {msg.model}
                      </span>
                    )}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <ToolCallBadges toolCalls={msg.toolCalls} />
                    )}
                  </div>
                )}

                {/* Message content */}
                <div
                  className={`text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user' ? 'text-[#F0FAF8]' : 'text-white/85'
                  }`}
                >
                  <FormattedContent content={msg.content} />
                </div>
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                  <User size={16} className="text-white/55" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Loading state */}
        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <div className="w-8 h-8 rounded-lg bg-[#34EAB9]/10 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-[#34EAB9]" />
            </div>
            <div className="flex items-center gap-2 text-sm text-white/55">
              <Loader2 size={14} className="animate-spin" />
              <span>Querying live data...</span>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll-to-bottom hint when there are messages */}
      {messages.length > 3 && (
        <div className="flex justify-center -mt-12 mb-2 relative z-10">
          <button
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="w-8 h-8 rounded-full bg-[#0F1A1E] border border-white/10 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-white/[0.06] px-4 py-3 lg:px-6">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-4xl mx-auto">
          {/* Model selector drop-up */}
          <div className="relative" ref={modelMenuRef}>
            <button
              type="button"
              onClick={() => setShowModelMenu(!showModelMenu)}
              disabled={loading}
              className={`flex items-center gap-1.5 text-[11px] font-mono px-3 py-3 rounded-xl border transition-all shrink-0 disabled:opacity-50 ${
                model === 'haiku'
                  ? 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:text-white/80'
                  : 'bg-[#34EAB9]/10 border-[#34EAB9]/20 text-[#34EAB9]'
              }`}
            >
              {MODEL_OPTIONS.find((m) => m.key === model)?.icon &&
                (() => {
                  const Icon = MODEL_OPTIONS.find((m) => m.key === model)!.icon
                  return <Icon size={12} />
                })()}
              <span className="hidden sm:inline">{MODEL_OPTIONS.find((m) => m.key === model)?.label}</span>
              {showModelMenu ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
            </button>

            <AnimatePresence>
              {showModelMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-white/[0.08] bg-[#0F1A1E] shadow-xl overflow-hidden z-50"
                >
                  <p className="text-[10px] text-white/30 uppercase tracking-wider px-3 pt-2.5 pb-1">Select model</p>
                  {MODEL_OPTIONS.map((opt) => {
                    const Icon = opt.icon
                    const isActive = model === opt.key
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                          setModel(opt.key)
                          setShowModelMenu(false)
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                          isActive
                            ? 'bg-[#34EAB9]/10 text-[#34EAB9]'
                            : 'text-white/60 hover:bg-white/[0.04] hover:text-white/90'
                        }`}
                      >
                        <Icon size={14} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{opt.label}</p>
                          <p className="text-[10px] text-white/35">{opt.description}</p>
                        </div>
                        {isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#34EAB9] shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about wallets, positions, market data..."
            disabled={loading}
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-[#F0FAF8] placeholder:text-white/30 focus:outline-none focus:border-[#34EAB9]/40 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-3 rounded-xl bg-[#34EAB9] text-[#0F1A1E] font-medium text-sm transition-all hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Send size={14} />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
        <p className="text-center text-white/25 text-[10px] mt-2">
          {MODEL_OPTIONS.find((m) => m.key === model)?.label} — {MODEL_OPTIONS.find((m) => m.key === model)?.description} · Queries live Hyperliquid data
        </p>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function ToolCallBadges({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-white/40 hover:text-white/60 transition-colors"
      >
        <Sparkles size={10} />
        {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''}
        <ChevronDown
          size={10}
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 space-y-1">
              {toolCalls.map((tc, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.04]"
                >
                  <span className="text-[#34EAB9] font-mono">
                    {TOOL_LABELS[tc.tool] || tc.tool}
                  </span>
                  <span className="text-white/30">→</span>
                  <span className="text-white/50 truncate">{tc.summary}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FormattedContent({ content }: { content: string }) {
  // Simple markdown-like formatting: bold, code, headers, lists
  const lines = content.split('\n')

  return (
    <>
      {lines.map((line, i) => {
        // Headers
        if (line.startsWith('### '))
          return (
            <p key={i} className="font-semibold text-[#F0FAF8] mt-3 mb-1 text-sm">
              {line.slice(4)}
            </p>
          )
        if (line.startsWith('## '))
          return (
            <p key={i} className="font-bold text-[#F0FAF8] mt-3 mb-1">
              {line.slice(3)}
            </p>
          )

        // Horizontal rule
        if (line.trim() === '---') return <hr key={i} className="border-white/10 my-2" />

        // Empty line
        if (line.trim() === '') return <br key={i} />

        // Table rows
        if (line.includes('|') && line.trim().startsWith('|')) {
          // Skip separator rows
          if (line.replace(/[\s|:-]/g, '') === '') return null
          const cells = line
            .split('|')
            .filter((c) => c.trim())
            .map((c) => c.trim())
          const isHeader = i + 1 < lines.length && lines[i + 1]?.replace(/[\s|:-]/g, '') === ''
          return (
            <div key={i} className={`flex gap-4 py-1 font-mono text-xs ${isHeader ? 'text-white/40 border-b border-white/10' : ''}`}>
              {cells.map((cell, j) => (
                <span key={j} className="flex-1 truncate">
                  <InlineFormatted text={cell} />
                </span>
              ))}
            </div>
          )
        }

        // List items
        if (line.match(/^\s*[-*]\s/))
          return (
            <p key={i} className="pl-3 relative">
              <span className="absolute left-0 text-[#34EAB9]">·</span>
              <InlineFormatted text={line.replace(/^\s*[-*]\s/, '')} />
            </p>
          )

        // Numbered list
        if (line.match(/^\s*\d+\.\s/))
          return (
            <p key={i} className="pl-4">
              <InlineFormatted text={line} />
            </p>
          )

        // Regular text
        return (
          <p key={i}>
            <InlineFormatted text={line} />
          </p>
        )
      })}
    </>
  )
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function InlineFormatted({ text }: { text: string }) {
  // Bold, inline code, and wallet addresses
  const parts = text.split(/(\*\*.*?\*\*|`[^`]+`|0x[a-fA-F0-9]{6,}\.{0,3}[a-fA-F0-9]{0,4})/g)

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return (
            <strong key={i} className="text-[#F0FAF8] font-semibold">
              {part.slice(2, -2)}
            </strong>
          )
        if (part.startsWith('`') && part.endsWith('`')) {
          const inner = part.slice(1, -1)
          // Wallet addresses inside backticks: clickable + copyable
          if (inner.match(/^0x[a-fA-F0-9]{40}$/)) {
            return <CopyableAddress key={i} address={inner} variant="white" />
          }
          return (
            <code
              key={i}
              className="text-[#34EAB9] bg-[#34EAB9]/10 px-1.5 py-0.5 rounded text-[11px] font-mono"
            >
              {inner}
            </code>
          )
        }
        if (part.match(/^0x[a-fA-F0-9]{6,}/)) {
          // Full addresses: clickable + copyable
          if (part.match(/^0x[a-fA-F0-9]{40}$/)) {
            return <CopyableAddress key={i} address={part} variant="white" />
          }
          // Truncated or partial addresses
          return (
            <code key={i} className="text-[#34EAB9] font-mono text-[11px]">
              {part}
            </code>
          )
        }
        // Color positive/negative values
        if (part.match(/\+\$[\d,.]+[KMB]?/))
          return (
            <span key={i} className="text-[#34EAB9] font-mono">
              {part}
            </span>
          )
        if (part.match(/-\$[\d,.]+[KMB]?/))
          return (
            <span key={i} className="text-[#FF3B5C] font-mono">
              {part}
            </span>
          )
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
