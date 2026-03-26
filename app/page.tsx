'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useErrorToast } from '@/lib/useErrorToast'
import Link from 'next/link'
import { MarketCard } from '@/components/MarketCard'
import { Input } from '@/components/ui/Input'
import { useT } from '@/context/I18nContext'
import { MarketListSkeleton } from '@/components/SectionSkeletons/MarketListSkeleton'

interface Market {
  id: string
  title: string
  marketType?: 'BINARY' | 'MULTI'
  category: string
  status: string
  totalVolume: number
  endDate: string
  probabilities: { yes: number; no: number }
  outcomes?: Array<{
    id: string
    outcomeName: string | null
    probabilities: { yes: number; no: number }
  }>
  _count?: { trades: number; comments: number }
  creator?: { username: string; avatar: string | null }
}

export default function HomePage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tHome = useT('home')
  const tCategories = useT('categories')
  const tStatus = useT('status')
  const [markets, setMarkets] = useState<Market[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<unknown>(null)

  const search = searchParams.get('search') ?? ''
  const category = searchParams.get('category') ?? 'All'
  const status = searchParams.get('status') ?? 'OPEN'
  const sortBy = searchParams.get('sortBy') ?? 'createdAt'
  const pageParam = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam

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

  const updateQuery = useCallback((updates: Record<string, string | number | null>) => {
    const nextParams = new URLSearchParams(searchParams.toString())

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || value === 'All' || (key === 'status' && value === 'OPEN') || (key === 'sortBy' && value === 'createdAt') || (key === 'page' && Number(value) === 1)) {
        nextParams.delete(key)
        return
      }

      nextParams.set(key, String(value))
    })

    const queryString = nextParams.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  const fetchMarkets = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
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
      } else {
        setFetchError('Failed to fetch markets')
      }
    } catch (err) {
      setFetchError(err)
      console.error('Failed to fetch markets:', err)
    } finally {
      setLoading(false)
    }
  }, [search, category, status, sortBy, page])

  useErrorToast(fetchError, tHome('fetchError') || 'Failed to fetch markets')

  useEffect(() => {
    const debounce = setTimeout(fetchMarkets, 300)
    return () => clearTimeout(debounce)
  }, [fetchMarkets])

  return (
    <div className="space-y-6 sm:space-y-8 px-2 sm:px-0">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white/90 dark:bg-gray-900/80 backdrop-blur-sm p-4 sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-20 h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-indigo-300/20 blur-3xl" />
        <div className="relative">
          <h1 className="text-3xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-3 leading-tight">
            {tHome('heroTitle')}{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-500">
              {tHome('heroHighlight')}
            </span>
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg max-w-3xl">
            {tHome('heroSubtitle')}
          </p>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 max-w-3xl">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Markets</div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white">{total}</div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white">{status === 'all' ? tStatus('all') : statuses.find((s) => s.value === status)?.label}</div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Category</div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white">{categories.find((c) => c.value === category)?.label}</div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Sort</div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white">{sortOptions.find((s) => s.value === sortBy)?.label}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white/90 dark:bg-gray-900/90 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-3 sm:p-5 space-y-4 backdrop-blur-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <Input
            placeholder={tHome('searchPlaceholder')}
            value={search}
            onChange={(e) => updateQuery({ search: e.target.value, page: 1 })}
            className="w-full sm:w-auto"
          />
          <select
            value={status}
            onChange={(e) => updateQuery({ status: e.target.value, page: 1 })}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-28 sm:min-w-36"
          >
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => updateQuery({ sortBy: e.target.value, page: 1 })}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-28 sm:min-w-36"
          >
            {sortOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 flex-wrap overflow-x-auto pb-1 -mx-1">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => updateQuery({ category: cat.value, page: 1 })}
              className={`px-3 py-2 rounded-full text-xs font-medium transition-colors border whitespace-nowrap ${
                category === cat.value
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
              }`}
              style={{ minWidth: 80 }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Markets Grid */}
      {loading ? (
        <MarketListSkeleton count={8} />
      ) : markets.length === 0 ? (
        <div className="text-center py-16 text-gray-500 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-white/60 dark:bg-gray-900/40">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-lg">{tHome('noMarkets')}</p>
          <p className="text-sm mt-1">{tHome('noMarketsHint')} <Link href="/markets/create" className="text-indigo-400 hover:underline">{tHome('createOne')}</Link>.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-600 dark:text-gray-400 text-sm">{tHome('marketsFound', { count: total })}</p>
          </div>
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {markets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
          {/* Pagination */}
          {total > 20 && (
            <div className="flex justify-center gap-2 mt-8">
              <button
                disabled={page === 1}
                onClick={() => updateQuery({ page: page - 1 })}
                className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
              >
                {tHome('previous')}
              </button>
              <span className="px-4 py-2 text-gray-600 dark:text-gray-400 text-sm border border-gray-200 dark:border-gray-800 rounded-lg bg-white/80 dark:bg-gray-900/80">{tHome('pageOf', { page, total: Math.ceil(total / 20) })}</span>
              <button
                disabled={page >= Math.ceil(total / 20)}
                onClick={() => updateQuery({ page: page + 1 })}
                className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
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
