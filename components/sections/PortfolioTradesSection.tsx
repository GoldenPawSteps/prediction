'use client'

import { usePageSection } from '@/lib/client-page-section'
import { TableSkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { formatCurrency, formatFixed, formatRelativeTime, getCategoryColor } from '@/lib/utils'
import { useT } from '@/context/I18nContext'
import { useErrorToast } from '@/lib/useErrorToast'
import { Badge } from '@/components/ui/Badge'
import Link from 'next/link'
import { beginNavFeedback } from '@/lib/client-nav-feedback'
import { useRouter } from 'next/navigation'
import { prefetchJson } from '@/lib/client-prefetch'

interface Trade {
  id: string
  outcome: string
  type: string
  shares: number
  price: number
  totalCost: number
  createdAt: string
  executionVenue?: 'AMM' | 'EXCHANGE'
  exchangeRole?: 'MAKER' | 'TAKER' | null
  market: { id: string; title: string; category: string }
}

interface PortfolioTradesData {
  trades: Trade[]
}

export function PortfolioTradesSection({ isPrefetched = false }: { isPrefetched?: boolean }) {
  const router = useRouter()
  const t = useT('portfolio')
  const tCategories = useT('categories')
  const tMarketDetail = useT('marketDetail')
  const tAdmin = useT('admin')
  const tTradePanel = useT('tradePanel')

  const prefetchMarketDetail = (marketId: string) => {
    const href = `/markets/${marketId}`
    router.prefetch(href)
    void prefetchJson(`market:${marketId}`, `/api/markets/${marketId}`)
  }

  const translateCategory = (category: string) => {
    switch (category) {
      case 'Politics': return tCategories('politics')
      case 'Crypto': return tCategories('crypto')
      case 'Sports': return tCategories('sports')
      case 'Tech': return tCategories('tech')
      case 'Entertainment': return tCategories('entertainment')
      case 'Science': return tCategories('science')
      case 'Finance': return tCategories('finance')
      case 'Other': return tCategories('other')
      default: return category
    }
  }

  const translateOutcome = (outcome: string) => {
    switch (outcome) {
      case 'YES': return tAdmin('yes')
      case 'NO': return tAdmin('no')
      case 'INVALID': return tAdmin('invalid')
      default: return outcome
    }
  }

  const translateTradeType = (type: string) => {
    switch (type) {
      case 'BUY': return tTradePanel('buy')
      case 'SELL': return tTradePanel('sell')
      default: return type
    }
  }

  const translateExchangeRole = (role?: 'MAKER' | 'TAKER' | null) => {
    if (role === 'MAKER') return tMarketDetail('makerLabel')
    if (role === 'TAKER') return tMarketDetail('takerLabel')
    return ''
  }

  // Load trades with lower refresh rate (historical data)
  const { data, isLoading, error } = usePageSection<PortfolioTradesData>({
    key: 'portfolio-trades',
    url: '/api/portfolio',
    revalidateInterval: 30000, // Refresh every 30 seconds
    shouldConsume: isPrefetched,
  })
  useErrorToast(error, 'Failed to load trades')

  if (isLoading) return <TableSkeleton rows={5} />

  const trades = data?.trades || []

  if (trades.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-600 dark:text-gray-400">{t('noTrades')}</p>
      </div>
    )
  }

  return (
    <SectionErrorBoundary sectionName="portfolio-trades">
      <div className="rounded-lg border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h3 className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white">{t('tradeHistory')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm border-separate border-spacing-0">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
              <tr>
                <th className="px-2 sm:px-6 py-2 sm:py-3 text-left font-semibold text-gray-700 dark:text-gray-300">{t('market')}</th>
                <th className="px-2 sm:px-6 py-2 sm:py-3 text-left font-semibold text-gray-700 dark:text-gray-300">{t('type')}</th>
                <th className="px-2 sm:px-6 py-2 sm:py-3 text-right font-semibold text-gray-700 dark:text-gray-300">{t('shares')}</th>
                <th className="px-2 sm:px-6 py-2 sm:py-3 text-right font-semibold text-gray-700 dark:text-gray-300">{t('price')}</th>
                <th className="px-2 sm:px-6 py-2 sm:py-3 text-right font-semibold text-gray-700 dark:text-gray-300">{t('total')}</th>
                <th className="px-2 sm:px-6 py-2 sm:py-3 text-left font-semibold text-gray-700 dark:text-gray-300">{t('date')}</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr
                  key={trade.id}
                  className="border-b border-gray-200 dark:border-gray-800 last:border-b-0 bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                >
                  <td className="px-2 sm:px-6 py-2 sm:py-4">
                    <Link
                      href={`/markets/${trade.market.id}`}
                      onMouseEnter={() => prefetchMarketDetail(trade.market.id)}
                      onFocus={() => prefetchMarketDetail(trade.market.id)}
                      onTouchStart={() => prefetchMarketDetail(trade.market.id)}
                      onClick={() => {
                        prefetchMarketDetail(trade.market.id)
                        beginNavFeedback(`/markets/${trade.market.id}`)
                      }}
                      className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline truncate max-w-xs"
                    >
                      {trade.market.title}
                    </Link>
                    <br />
                    <Badge
                      variant="info"
                      className={`mt-1 text-xs ${getCategoryColor(trade.market.category)}`}
                    >
                      {translateCategory(trade.market.category)}
                    </Badge>
                  </td>
                  <td className="px-2 sm:px-6 py-2 sm:py-4">
                    <div className="flex items-center gap-1 sm:gap-2">
                      <Badge variant={trade.outcome === 'YES' ? 'success' : 'danger'}>
                        {translateOutcome(trade.outcome)}
                      </Badge>
                      <Badge variant={trade.type === 'BUY' ? 'success' : 'danger'}>
                      {trade.executionVenue === 'EXCHANGE' ? (
                        <>
                          <Badge variant="info">{tTradePanel('exchange')}</Badge>
                          {trade.exchangeRole && (
                            <Badge variant="warning">{translateExchangeRole(trade.exchangeRole)}</Badge>
                          )}
                        </>
                      ) : (
                        <Badge variant="default">{tTradePanel('amm')}</Badge>
                      )}
                        {translateTradeType(trade.type)}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-2 sm:px-6 py-2 sm:py-4 text-right text-gray-900 dark:text-white font-medium">
                    {formatFixed(trade.shares)}
                  </td>
                  <td className="px-2 sm:px-6 py-2 sm:py-4 text-right text-gray-600 dark:text-gray-400">
                    {formatCurrency(trade.price)}
                  </td>
                  <td className="px-2 sm:px-6 py-2 sm:py-4 text-right font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(Math.abs(trade.totalCost))}
                  </td>
                  <td className="px-2 sm:px-6 py-2 sm:py-4 text-left text-gray-600 dark:text-gray-400 text-xs">
                    {formatRelativeTime(trade.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionErrorBoundary>
  )
}
