'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { MarketCard } from '@/components/MarketCard'
import { Input } from '@/components/ui/Input'
import { useT } from '@/context/I18nContext'

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
  const tHome = useT('home')
  const tCategories = useT('categories')
  const tStatus = useT('status')
  const [markets, setMarkets] = useState<Market[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [status, setStatus] = useState('OPEN')
  const [sortBy, setSortBy] = useState('createdAt')
  const [page, setPage] = useState(1)

  const categories = [
    { value: 'All', label: tCategories('all') },
    { value: 'Politics', label: tCategories('politics') },
    { value: 'Crypto', label: tCategories('crypto') },
    { value: 'Sports', label: tCategories('sports') },
    { value: 'Tech', label: tCategories('tech') },
    { value: 'Entertainment', label: tCategories('entertainment') },
    { value: 'Science', label: tCategories('science') },
    { value: 'Finance', label: tCategories('finance') },
    { value: 'Other', label: tCategories('other') },
  ]

  const statuses = [
    { value: 'OPEN', label: tStatus('open') },
    { value: 'CLOSED', label: tStatus('closed') },
    { value: 'DISPUTED', label: tStatus('disputed') },
    { value: 'INVALID', label: tStatus('invalid') },
    { value: 'RESOLVED', label: tStatus('resolved') },
    { value: 'all', label: tStatus('all') },
  ]

  const sortOptions = [
    { value: 'createdAt', label: tHome('sortNewest') },
    { value: 'volume', label: tHome('sortVolume') },
  ]

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
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
          {tHome('heroTitle')}{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
            {tHome('heroHighlight')}
          </span>
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-lg max-w-2xl mx-auto">
          {tHome('heroSubtitle')}
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder={tHome('searchPlaceholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {sortOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => { setCategory(cat.value); setPage(1) }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                category === cat.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Markets Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-200/50 dark:bg-gray-800/50 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-lg">{tHome('noMarkets')}</p>
          <p className="text-sm mt-1">{tHome('noMarketsHint')} <Link href="/markets/create" className="text-indigo-400 hover:underline">{tHome('createOne')}</Link>.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 dark:text-gray-400 text-sm">{tHome('marketsFound', { count: total })}</p>
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
                className="px-4 py-2 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-300 dark:hover:bg-gray-700 text-sm"
              >
                {tHome('previous')}
              </button>
              <span className="px-4 py-2 text-gray-600 dark:text-gray-400 text-sm">{tHome('pageOf', { page, total: Math.ceil(total / 20) })}</span>
              <button
                disabled={page >= Math.ceil(total / 20)}
                onClick={() => setPage(p => p + 1)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-300 dark:hover:bg-gray-700 text-sm"
              >
                {tHome('next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
