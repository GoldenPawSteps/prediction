'use client'

import { useState, useEffect, useCallback } from 'react'
import { MarketCard } from '@/components/MarketCard'
import { Input } from '@/components/ui/Input'

const CATEGORIES = ['All', 'Politics', 'Crypto', 'Sports', 'Tech', 'Entertainment', 'Science', 'Finance', 'Other']
const STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'DISPUTED', label: 'Disputed' },
  { value: 'INVALID', label: 'Invalid' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'all', label: 'All' },
]
const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Newest' },
  { value: 'volume', label: 'Most Volume' },
]

interface Market {
  id: string
  title: string
  category: string
  status: string
  totalVolume: number
  endDate: string
  probabilities: { yes: number; no: number }
  _count?: { trades: number; comments: number }
  creator?: { username: string; avatar: string | null }
}

export default function HomePage() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [status, setStatus] = useState('OPEN')
  const [sortBy, setSortBy] = useState('createdAt')
  const [page, setPage] = useState(1)

  const fetchMarkets = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        ...(search && { search }),
        ...(category !== 'All' && { category }),
        status,
        sortBy,
        page: page.toString(),
        limit: '20',
      })
      const res = await fetch(`/api/markets?${params}`)
      if (res.ok) {
        const data = await res.json()
        setMarkets(data.markets)
        setTotal(data.total)
      }
    } catch (err) {
      console.error('Failed to fetch markets:', err)
    } finally {
      setLoading(false)
    }
  }, [search, category, status, sortBy, page])

  useEffect(() => {
    const debounce = setTimeout(fetchMarkets, 300)
    return () => clearTimeout(debounce)
  }, [fetchMarkets])

  return (
    <div>
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-white mb-3">
          Predict the Future.{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
            Profit from It.
          </span>
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          Trade on real-world events. Buy YES or NO shares and earn when you&apos;re right.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search markets..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { setCategory(cat); setPage(1) }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                category === cat
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Markets Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-800/50 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-lg">No markets found.</p>
          <p className="text-sm mt-1">Try different filters or <a href="/markets/create" className="text-indigo-400 hover:underline">create one</a>.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-400 text-sm">{total} markets found</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {markets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
          {/* Pagination */}
          {total > 20 && (
            <div className="flex justify-center gap-2 mt-8">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-700 text-sm"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-gray-400 text-sm">Page {page} of {Math.ceil(total / 20)}</span>
              <button
                disabled={page >= Math.ceil(total / 20)}
                onClick={() => setPage(p => p + 1)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-700 text-sm"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
